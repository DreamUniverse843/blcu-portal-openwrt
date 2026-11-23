import importlib.machinery
import importlib.util
import ipaddress
from io import StringIO
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
                           side_effect=[state.copy(), client.Retry("timeout"), state.copy(), state.copy(), KeyboardInterrupt]),
              patch.object(client, "attempt_login", return_value=False) as login,
              patch.object(client, "authentication_event"),
              patch.object(client.time, "sleep")):
            with self.assertRaises(KeyboardInterrupt):
                client.run("watch", "wwan", None, 30, 2)
        login.assert_called_once()

    def test_dual_stack_distinguishes_families_and_keeps_online_path(self):
        ipv4 = ipaddress.ip_address("192.0.2.3")
        ipv6 = ipaddress.ip_address("2001:db8::3")
        self.assertEqual(client.connection_paths(self.wan, ipv4, "dual", ipv6), [(4, ipv4), (6, ipv6)])
        state = {"online": True, "endpoint": {"source": "192.0.2.20"},
                 "portal_login_time": ""}
        def probe(_wan, version, _target):
            return (state.copy(), None) if version == 4 else (None, "无 IPv6 响应")
        with (patch.object(client, "read_interface", return_value=self.wan),
              patch.object(client, "read_path", side_effect=probe),
              patch.object(client, "saved_login", return_value="")):
            result = client.snapshot("wwan", ipv4, "dual", ipv6)
        self.assertEqual(result["state"], "partial")
        self.assertEqual([row["state"] for row in result["paths"]], ["online", "unknown"])

    def test_auth_log_is_bounded_and_does_not_use_server_text(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(client, "EVENT_LOG", Path(folder) / "events.json"):
                for number in range(103):
                    client.authentication_event("wwan", "state", str(number), 4)
                events = client.read_events()
        self.assertEqual((len(events), events[0]["reason"], events[-1]["reason"]), (100, "3", "102"))
        self.assertEqual(client.rejection_reason({"msg": "user example password xxx"}),
                         "校园网账号或密码未通过验证")

    def test_update_checks_release_without_installing(self):
        source = "https://github.com/example/project/releases"
        self.assertEqual(client.release_source(source),
                         "https://github.com/example/project/releases/latest")
        with self.assertRaises(ValueError):
            client.release_source("http://example.com/releases")
        response = subprocess.CompletedProcess([], 0, b"https://github.com/example/project/releases/tag/v1.0.0")
        with tempfile.TemporaryDirectory() as folder:
            with (patch.object(client, "UPDATE_STATE", Path(folder) / "update.json"),
                  patch.object(client.subprocess, "run", return_value=response) as run):
                checked = client.check_update(source)
        self.assertTrue(checked["available"])
        self.assertEqual(checked["latest"], "1.0.0")
        self.assertEqual(run.call_args.args[0][0], "curl")
        run.assert_called_once()

    def test_custom_json_release_source(self):
        response = subprocess.CompletedProcess([], 0, b'{"tag_name":"1.0.0","draft":false}')
        with patch.object(client.subprocess, "run", return_value=response):
            self.assertEqual(client.fetch_release("https://mirror.example/latest.json")["tag_name"], "1.0.0")

    def test_pool_keeps_one_account_per_uplink_and_never_returns_passwords(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            primary = root / "credentials.json"
            primary.write_text('{"account":"primary","password":"main-secret"}')
            with (patch.object(client, "POOL", root / "accounts.json"),
                  patch.object(client, "POOL_STATUS", root / "state.json"),
                  patch.object(client, "SECRETS", primary),
                  patch.object(client.subprocess, "run", return_value=subprocess.CompletedProcess(
                      [], 0, b"network.interface.wwan2"))):
                with self.assertRaises(client.Stop):
                    client.edit_pool("wwan", {"interface": "wwan", "account": "x", "password": "test"})
                client.edit_pool("wwan", {"interface": "wwan2", "account": "roommate",
                                          "password": "example", "enabled": "1"})
                client.edit_pool("wwan", {"interface": "wwan2", "account": "roommate",
                                          "password": "", "enabled": "0"})
                self.assertEqual(client.read_mapping(client.POOL)["wwan2"]["password"], "example")
                self.assertEqual(client.pool_rows()[0]["status"]["state"], "disabled")
                self.assertNotIn("password", client.pool_rows()[0])
                with self.assertRaises(client.Stop):
                    client.edit_pool("wwan", {"interface": "wwan3", "account": "roommate",
                                              "password": "different", "enabled": "1"})
                client.edit_pool("wwan", {"interface": "wwan2"}, remove=True)
                self.assertEqual(client.pool_rows(), [])

    def test_pool_rejects_virtual_or_duplicate_devices(self):
        physical = {**self.wan, "name": "wwan2", "device": "phy2-sta0", "mac": "02:00:00:00:00:02"}
        duplicate = {**physical, "name": "wwan3"}
        virtual = {**physical, "name": "wwan4", "device": "macvlan0", "kind": "macvlan"}
        links = {"wwan": self.wan, "wwan2": physical, "wwan3": duplicate, "wwan4": virtual}
        other = {name: {"enabled": True, "account": name} for name in links if name != "wwan"}
        with (patch.object(client, "read_interface", side_effect=links.__getitem__),
              patch.object(client, "read_mapping", return_value={"account": "primary"})):
            candidates, rejected = client.pool_probe("wwan", other)
        self.assertEqual(list(candidates), ["wwan2"])
        self.assertIn("实际设备或 MAC", rejected["wwan3"]["message"])
        self.assertIn("实际网络设备", rejected["wwan4"]["message"])

    def test_pool_never_submits_for_another_online_account(self):
        entry = {"enabled": True, "account": "roommate", "password": "example"}
        wan = {**self.wan, "name": "wwan2"}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with (patch.object(client, "POOL", root / "accounts.json"),
                  patch.object(client, "POOL_STATUS", root / "state.json"),
                  patch.object(client, "pool_probe", return_value=({"wwan2": wan}, {})),
                  patch.object(client, "check_connection", return_value=(
                      [{"online": True, "account": "someone-else"}], {})),
                  patch.object(client, "attempt_login") as login):
                client.write_private_json(client.POOL, {"wwan2": entry})
                client.pool_cycle("wwan", None, "auto", None, 1, {})
                self.assertEqual(client.pool_rows()[0]["status"]["state"], "failed")
                login.assert_not_called()

    def test_pool_confirmation_checks_the_authenticated_account(self):
        with (patch.object(client.time, "sleep"),
              patch.object(client, "check_status", return_value={
                  "online": True, "account": "other-account"
              }),
              patch.object(client, "observe_login") as observe):
            with self.assertRaises(client.Stop):
                client.confirm_login(self.wan, None, expected_account="roommate")
            observe.assert_not_called()

    def test_pool_mode_can_reuse_the_existing_uplink_and_account(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = root / "credentials.json"
            old.write_text('{"account":"student","password":"secret"}')
            with (patch.object(client, "POOL", root / "accounts.json"),
                  patch.object(client, "POOL_STATUS", root / "pool-status.json"),
                  patch.object(client, "SECRETS", old),
                  patch.object(client.sys, "stdin", StringIO(
                      '{"interface":"wwan","account":":main-credentials","enabled":"1"}')),
                  patch.object(client.subprocess, "run", return_value=subprocess.CompletedProcess(
                      [], 0, b"network.interface.wwan")),
                  patch("builtins.print")):
                client.serve_rpc("rpc-pool-save", "wwan", None, "auto", None, "", True, "pool")
                self.assertEqual(client.selected_pool_member()[0], "wwan")
                self.assertEqual(client.pool_rows()[0]["account"], "student")

    def test_ipv6_upstream_shows_dhcpv6_child_but_excludes_other_networks(self):
        wire = {"interface": [
            {"interface": "wwan", "up": True, "l3_device": "phy1-sta0"},
            {"interface": "wwan_6", "up": True, "proto": "dhcpv6", "l3_device": "phy1-sta0",
             "ipv6-address": [{"address": "2001:db8::20", "mask": 128}],
             "ipv6-prefix": [{"address": "2001:db8:1234::", "mask": 48, "valid": 3600}],
             "route": [{"target": "::", "mask": 0}], "dns-server": ["2001:db8::53", "192.0.2.53"]},
            {"interface": "lan", "up": True, "l3_device": "br-lan"}
        ]}
        with patch.object(client.subprocess, "run", return_value=subprocess.CompletedProcess(
                [], 0, json.dumps(wire).encode())):
            uplinks = client.ipv6_upstreams("wwan", False)["upstreams"]
        self.assertEqual([entry["interface"] for entry in uplinks], ["wwan", "wwan_6"])
        self.assertTrue(uplinks[1]["default_route"])
        self.assertEqual(uplinks[1]["prefixes"][0]["prefix"], "2001:db8:1234::/48")
        self.assertEqual(uplinks[1]["dns"], ["2001:db8::53"])


if __name__ == "__main__":
    unittest.main()
