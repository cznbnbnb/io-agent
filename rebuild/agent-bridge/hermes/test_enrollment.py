"""Registration and tool restrictions fail before dispatch/model execution."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from enroll_home import limited_provider, enroll
from restricted_profile import NAMES, POLICY, CLI_POLICY, WORKSPACE_POLICY, read_policy, enforce_question_tools
from runtime_journal import RuntimeJournalError


class EnrollmentTests(unittest.TestCase):
    def provider(self):
        return {'custom_providers':[{'name':'selected','base_url':'https://example.invalid/v1',
            'api_key':'synthetic-credential-only', 'api_mode':'chat_completions',
            'extra_headers':{'Authorization':'not-copied'}, 'models_discovered':['not-copied']},
            {'name':'unrelated','api_key':'unrelated-secret'}], 'hooks':{'on_run':'not-copied'},
            'platform_toolsets':{'acp':['terminal','file']},'mcp_servers':{'office':{}}}

    def test_only_selected_provider_and_question_profile_are_imported(self):
        source=self.provider(); before=copy.deepcopy(source)
        result=limited_provider(source,'selected','test-model')
        self.assertEqual(source,before)
        self.assertEqual(len(result['custom_providers']),1)
        self.assertEqual(set(result['custom_providers'][0]),{'name','base_url','api_key','api_mode'})
        self.assertNotIn('hooks',result)
        self.assertEqual(result['platform_toolsets'],{'acp':[]})
        self.assertEqual(result['mcp_servers'],{})
        self.assertEqual(result['tools']['tool_search']['enabled'],'off')

    def test_duplicate_provider_or_endpoint_credentials_are_rejected(self):
        source=self.provider();source['custom_providers'].append(source['custom_providers'][0])
        with self.assertRaises(RuntimeJournalError):limited_provider(source,'selected','test-model')
        for endpoint in ['http://example.invalid','https://user:secret@example.invalid',
                         'https://example.invalid/v1?key=secret','https://example.invalid/#secret']:
            source=self.provider();source['custom_providers'][0]['base_url']=endpoint
            with self.assertRaises(RuntimeJournalError):limited_provider(source,'selected','test-model')

    def test_existing_home_never_adopted_or_modified(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);file=home/'keep.txt';file.write_text('keep')
            spec={'home':str(home),'cwd':str(home),'source':str(home),'site_packages':str(home),
                  'provider_config':str(file),'provider_name':'selected','model':'test',
                  'project_id':'p','binding':{name:'synthetic' for name in
                    ['server_id','owner_id','producer_id','computer_id','agent_id']}}
            with self.assertRaisesRegex(RuntimeJournalError,'ENROLL_HOME_ALREADY_EXISTS'):enroll(spec)
            self.assertEqual(list(home.iterdir()),[file]);self.assertEqual(file.read_text(),'keep')

    def test_unknown_policy_rejected_and_absent_policy_preserves_existing_mode(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertIsNone(read_policy(temp))
            file=Path(temp)/'.turboio-tool-policy.json';file.write_text(json.dumps(POLICY))
            self.assertEqual(read_policy(temp),POLICY)
            file.write_text(json.dumps({**POLICY,'profile':'silently-enable-office'}))
            with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_TOOL_POLICY_INVALID'):read_policy(temp)

    def agent(self):
        schemas=[{'function':{'name':name}} for name in sorted(NAMES)]
        return types.SimpleNamespace(tools=schemas,valid_tool_names=set(NAMES),
                                     enabled_toolsets=['mcp-turboio_questions'],disabled_toolsets=[])

    def test_direct_questions_allowed_but_hidden_unsafe_dispatch_rejected(self):
        agent=self.agent()
        module=types.SimpleNamespace(get_tool_definitions=lambda **kwargs:agent.tools)
        with patch.dict(sys.modules,{'model_tools':module}):enforce_question_tools(agent)
        module.get_tool_definitions=lambda **kwargs:agent.tools+[{'function':{'name':'terminal'}}]
        with patch.dict(sys.modules,{'model_tools':module}):
            with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_UNEXPECTED_TOOLS'):enforce_question_tools(agent)

    def test_tool_search_or_extra_toolset_cannot_expand_profile(self):
        agent=self.agent();raw=list(agent.tools)
        module=types.SimpleNamespace(get_tool_definitions=lambda **kwargs:raw)
        for change in ['bridge','extra-toolset']:
            agent=self.agent()
            if change=='bridge':agent.tools=[{'function':{'name':'tool_call'}}]
            else:agent.enabled_toolsets.append('terminal')
            with patch.dict(sys.modules,{'model_tools':module}):
                with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_UNEXPECTED_TOOLS'):enforce_question_tools(agent)

    def workspace_agent(self,policy=WORKSPACE_POLICY):
        names=policy['tools']
        toolsets=['turboio-questions-cli']+(['file','terminal'] if policy==WORKSPACE_POLICY else [])
        return types.SimpleNamespace(tools=[{'function':{'name':name}} for name in names],valid_tool_names=set(names),
                                     enabled_toolsets=toolsets,disabled_toolsets=[])

    def test_workspace_profile_allows_exactly_file_terminal_and_question_tools(self):
        agent=self.workspace_agent();raw=list(agent.tools)
        module=types.SimpleNamespace(get_tool_definitions=lambda **kwargs:raw)
        with patch.dict(sys.modules,{'model_tools':module}):enforce_question_tools(agent,WORKSPACE_POLICY)
        for extra in ['browser_navigate','computer_use','memory','delegate_task']:
            module.get_tool_definitions=lambda **kwargs:raw+[{'function':{'name':extra}}]
            with patch.dict(sys.modules,{'model_tools':module}):
                with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_UNEXPECTED_TOOLS'):enforce_question_tools(agent,WORKSPACE_POLICY)
        agent=self.workspace_agent();agent.enabled_toolsets.append('browser')
        module.get_tool_definitions=lambda **kwargs:raw
        with patch.dict(sys.modules,{'model_tools':module}):
            with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_UNEXPECTED_TOOLS'):enforce_question_tools(agent,WORKSPACE_POLICY)

    def test_question_profile_cannot_borrow_workspace_tools(self):
        wide=self.workspace_agent();narrow=self.workspace_agent(CLI_POLICY)
        module=types.SimpleNamespace(get_tool_definitions=lambda **kwargs:wide.tools)
        with patch.dict(sys.modules,{'model_tools':module}):
            with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_UNEXPECTED_TOOLS'):enforce_question_tools(narrow,CLI_POLICY)
            with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_UNEXPECTED_TOOLS'):enforce_question_tools(wide,CLI_POLICY)

    def test_workspace_policy_file_accepted_and_unknown_enrollment_profile_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'.turboio-tool-policy.json';file.write_text(json.dumps(WORKSPACE_POLICY))
            self.assertEqual(read_policy(temp),WORKSPACE_POLICY)
            file.write_text(json.dumps({**WORKSPACE_POLICY,'tools':WORKSPACE_POLICY['tools']+['browser_navigate']}))
            with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_TOOL_POLICY_INVALID'):read_policy(temp)
            home=Path(temp)/'new-home'
            spec={'home':str(home),'cwd':temp,'source':temp,'site_packages':temp,'provider_config':str(file),
                  'provider_name':'selected','model':'test','project_id':'p','profile':'io-full-access',
                  'binding':{name:'synthetic' for name in ['server_id','owner_id','producer_id','computer_id','agent_id']}}
            with self.assertRaisesRegex(RuntimeJournalError,'ENROLL_PROFILE_INVALID'):enroll(spec)
            self.assertFalse(home.exists())


if __name__=='__main__':unittest.main()
