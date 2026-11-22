import importlib.util
import io
import json
import struct
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('host', Path(__file__).resolve().parents[1] / 'native' / 'host.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

class Stream:
    def __init__(self, data=b''):
        self.buffer = io.BytesIO(data)

class HostTest(unittest.TestCase):
    def invoke(self, answer, code=0):
        data = json.dumps({'question': '日中につながる番号', 'choices': ['電話番号', 'メール']}, ensure_ascii=False).encode()
        stdin, stdout = Stream(struct.pack('=I', len(data)) + data), Stream()
        result = type('Result', (), {'stdout': answer, 'returncode': code})()
        with patch.object(host.sys, 'stdin', stdin), patch.object(host.sys, 'stdout', stdout), patch.object(host.subprocess, 'run', return_value=result) as run:
            host.main()
        payload = stdout.buffer.getvalue()
        self.assertEqual(struct.unpack('=I', payload[:4])[0], len(payload[4:]))
        self.assertEqual(run.call_args.args[0][:2], ['/usr/bin/fm', 'respond'])
        return json.loads(payload[4:])

    def test_exact_answer(self):
        self.assertEqual(self.invoke('電話番号\n'), {'answer': '電話番号'})

    def test_uncertain_answer(self):
        self.assertEqual(self.invoke('電話番号だと思います'), {'answer': ''})

    def test_cli_error(self):
        self.assertIn('exit 69', self.invoke('', 69)['error'])

if __name__ == '__main__':
    unittest.main()
