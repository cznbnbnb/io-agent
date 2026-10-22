"""Explicit local administration, not a skill tool or an automatic recovery hook."""
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))
from managed_home import private_json
from reconciliation import inspect, apply
from runtime_journal import RuntimeJournalError


def main():
    try:
        action,*args=sys.argv[1:]
        expected={'--config','--operation'} if action=='inspect' else {'--config','--decision'}
        if action not in {'inspect','apply'} or len(args)!=4 or set(args[::2])!=expected:
            raise RuntimeJournalError('RUNTIME_REVIEW_ARGUMENTS_INVALID')
        options=dict(zip(args[::2],args[1::2]))
        config=private_json(options['--config'])
        result=(inspect(config,options['--operation']) if action=='inspect' else
                apply(config,private_json(options['--decision'],maximum=262144)))
        sys.stdout.buffer.write((json.dumps(result,ensure_ascii=False)+'\n').encode('utf-8'))
        return 0
    except Exception as error:
        code=error.code if isinstance(error,RuntimeJournalError) else 'RUNTIME_REVIEW_FAILED'
        sys.stdout.buffer.write((json.dumps({'error':code})+'\n').encode('utf-8'))
        return 2


if __name__=='__main__':
    raise SystemExit(main())
