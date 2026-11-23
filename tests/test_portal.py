import importlib.machinery
import importlib.util
import ipaddress
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader(
    "client", str(Path(__file__).resolve().parents[1] / "files/blcu-portal")
)
spec = importlib.util.spec_from_loader("client", loader)
client = importlib.util.module_from_spec(spec)
loader.exec_module(client)


class PortalTest(unittest.TestCase):
    def setUp(self):
        self.wan = {
            "name": "wwan", "device": "phy1-sta0", "mac": "02:00:00:00:00:01",
            "addresses": {4: ["192.0.2.20"], 6: ["2001:db8::20"]},
        }

    def reply(self, body, endpoints):
        wire = "blcuPortal(" + json.dumps(body) + ");\n" + endpoints
        return subprocess.CompletedProcess([], 0, wire.encode())

    def test_ipv4_status_and_override(self):
        value = self.reply({"result": 1, "v4ip": "192.0.2.20",
                            "stime": "2026-11-24 01:00:00"}, "192.0.2.20 192.0.2.3 443")
        with patch.object(client.subprocess, "run", return_value=value) as curl:
            status = client.check_status(self.wan, ipaddress.ip_address("192.0.2.3"))
        self.assertTrue(status["online"])
        self.assertEqual(status["endpoint"]["port"], 443)
        self.assertIn("login.blcu.edu.cn:443:192.0.2.3", curl.call_args.args[0])

    def test_ipv6_override_and_source(self):
        value = self.reply({"result": 1, "v6ip": "2001:db8:0:0::20"},
                           "2001:db8::20 2001:db8::3 443")
        with patch.object(client.subprocess, "run", return_value=value) as curl:
            status = client.check_status(self.wan, ipaddress.ip_address("2001:db8::3"))
        self.assertTrue(status["online"])
        self.assertIn("login.blcu.edu.cn:443:[2001:db8::3]", curl.call_args.args[0])
        self.assertIn("-6", curl.call_args.args[0])

    def test_does_not_accept_other_terminal(self):
        value = self.reply({"result": 1, "v4ip": "192.0.2.21"}, "192.0.2.20 192.0.2.3 443")
        with patch.object(client.subprocess, "run", return_value=value):
            with self.assertRaises(client.Retry):
                client.check_status(self.wan, None)

    def test_last_login_survives_offline_status(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / "last-login.json"
            with patch.object(client, "LAST_LOGIN", log):
                client.observe_login(self.wan, None, {"portal_login_time": "2026-11-24 01:00:00"})
                self.assertEqual(client.observe_login(
                    self.wan, None, {"portal_login_time": ""}), "2026-11-24 01:00:00")
                self.assertEqual(client.saved_login("wan", None), "")

    def test_account_summary_keeps_only_requested_fields(self):
        peer = {"source": "192.0.2.20"}
        state = {"account": "student", "online": True, "endpoint": peer}
        with tempfile.TemporaryDirectory() as folder:
            credentials = Path(folder) / "credentials.json"
            credentials.write_text('{"account":"student"}')
            with (patch.object(client, "SECRETS", credentials),
                  patch.object(client, "read_interface", return_value=self.wan),
                  patch.object(client, "check_status", return_value=state),
                  patch.object(client, "request") as request):
                request.side_effect = lambda _, ip, url, *args, **kwargs: (
                    {"code": 1, "data": [{"login_mac": "private"}]}
                    if url.endswith("loadOnlineDevice") else
                    {"code": 1, "remain_flow": 0, "curr_group": "Plan", "user_name": "private"},
                    peer,
                )
                self.assertEqual(client.account_summary("wwan", None),
                                 {"online_devices": 1, "remain_flow": 0, "curr_group": "Plan"})
                state["account"] = "someone-else"
                request.reset_mock()
                self.assertIn("message", client.account_summary("wwan", None))
                request.assert_not_called()

    def test_watch_requires_consecutive_offline_responses(self):
        state = {"online": False}
        with (patch.object(client, "read_interface", return_value=self.wan),
              patch.object(client, "check_status",
                           side_effect=[state, client.Retry("timeout"), state, state, KeyboardInterrupt]),
              patch.object(client, "login") as login,
              patch.object(client, "confirm_login", return_value=False),
              patch.object(client.time, "sleep")):
            with self.assertRaises(KeyboardInterrupt):
                client.run("watch", "wwan", None, 30, 2)
        login.assert_called_once()


if __name__ == "__main__":
    unittest.main()
