"""Explicit enrollment tool profiles for real-provider runs.

These are tool allowlists, not an OS sandbox for malicious installed code. The
question-only profile stays the default; the workspace profile adds pinned
Hermes file and terminal tools only when enrollment names it explicitly.
"""
from pathlib import Path
from managed_home import private_json
from runtime_journal import RuntimeJournalError

POLICY = {'schema': 1, 'profile': 'io-question-only-v1',
          'mcp_server': 'turboio_questions', 'tools': ['ask_user', 'wait_answer']}
NAMES = frozenset('mcp__turboio_questions__' + name for name in POLICY['tools'])
CLI_POLICY = {'schema': 1, 'profile': 'io-question-cli-v1',
              'tools': ['io_ask_user','io_wait_answer','io_question_status']}
# Owner-approved 2026-10-22: file edits are auto-allowed only inside the session
# cwd (ACP accept_edits); sensitive paths and dangerous commands still request
# permission, which the transport never grants.
WORKSPACE_POLICY = {'schema': 1, 'profile': 'io-workspace-cli-v1',
                    'tools': CLI_POLICY['tools'] + ['read_file','write_file','patch','search_files','terminal','process_manage']}
CLI_POLICIES = (CLI_POLICY, WORKSPACE_POLICY)
WORKSPACE_TOOLSETS = ['file', 'terminal']


def read_policy(home):
    file = Path(home) / '.turboio-tool-policy.json'
    if not file.exists() and not file.is_symlink():
        return None
    value=private_json(file)
    if value not in [POLICY,*CLI_POLICIES]:
        raise RuntimeJournalError('RUNTIME_TOOL_POLICY_INVALID')
    return value


def enforce_question_tools(agent, policy=POLICY):
    # Check both model-visible schemas and the raw dispatchable catalog. A
    # tool-search bridge can hide unsafe tools from the former but expose them
    # through tool_call; this profile deliberately requires direct MCP tools.
    from model_tools import get_tool_definitions
    raw = get_tool_definitions(enabled_toolsets=agent.enabled_toolsets,
        disabled_toolsets=agent.disabled_toolsets, quiet_mode=True,
        skip_tool_search_assembly=True)
    def names(schemas):
        try:
            values = [item['function']['name'] for item in schemas]
            if len(values) != len(set(values)):
                raise ValueError()
            return set(values)
        except Exception:
            raise RuntimeJournalError('RUNTIME_TOOL_SURFACE_INVALID') from None
    expected=set(policy['tools']) if policy in CLI_POLICIES else NAMES
    toolsets={'turboio-questions-cli'} if policy in CLI_POLICIES else {'mcp-turboio_questions'}
    if policy==WORKSPACE_POLICY:
        toolsets|=set(WORKSPACE_TOOLSETS)
    if (names(raw) != expected or names(agent.tools) != expected
            or set(agent.valid_tool_names) != expected
            or set(agent.enabled_toolsets) != toolsets):
        raise RuntimeJournalError('RUNTIME_UNEXPECTED_TOOLS')
