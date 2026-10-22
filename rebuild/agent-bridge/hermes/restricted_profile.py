"""Explicit question-only enrollment profile for real-provider validation.

This is a tool allowlist, not an OS sandbox for malicious installed code. Normal
production tool enrollment is a separate decision; never silently enable it.
"""
from pathlib import Path
from managed_home import private_json
from runtime_journal import RuntimeJournalError

POLICY = {'schema': 1, 'profile': 'io-question-only-v1',
          'mcp_server': 'turboio_questions', 'tools': ['ask_user', 'wait_answer']}
NAMES = frozenset('mcp__turboio_questions__' + name for name in POLICY['tools'])
CLI_POLICY = {'schema': 1, 'profile': 'io-question-cli-v1',
              'tools': ['io_ask_user','io_wait_answer','io_question_status']}


def read_policy(home):
    file = Path(home) / '.turboio-tool-policy.json'
    if not file.exists() and not file.is_symlink():
        return None
    value=private_json(file)
    if value not in [POLICY,CLI_POLICY]:
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
    expected=set(CLI_POLICY['tools']) if policy==CLI_POLICY else NAMES
    toolset='turboio-questions-cli' if policy==CLI_POLICY else 'mcp-turboio_questions'
    if (names(raw) != expected or names(agent.tools) != expected
            or set(agent.valid_tool_names) != expected
            or set(agent.enabled_toolsets) != {toolset}):
        raise RuntimeJournalError('RUNTIME_UNEXPECTED_TOOLS')
