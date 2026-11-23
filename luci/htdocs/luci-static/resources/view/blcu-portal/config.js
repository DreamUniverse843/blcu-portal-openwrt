'use strict';
'require form';
'require poll';
'require rpc';
'require ui';
'require view';
'require tools.widgets as widgets';

const status = rpc.declare({ object: 'blcu-portal', method: 'status', reject: true });
const accountSummary = rpc.declare({ object: "blcu-portal", method: "account", reject: true });
const credentials = rpc.declare({
	object: 'blcu-portal',
	method: 'credentials',
	params: [ 'account', 'password' ],
	reject: true
});
const login = rpc.declare({ object: 'blcu-portal', method: 'login', reject: true });

function showError(error) {
	ui.addNotification(null, E('p', {}, error.message || String(error)));
}

function rows(entries) {
	return entries.map(([ label, value ]) => E('tr', { class: 'tr' }, [
		E('th', { class: 'td', scope: 'row' }, label),
		E('td', { class: 'td' }, value != null && value !== '' ? String(value) : '—')
	]));
}

function statusRows(data) {
	const endpoint = data.endpoint || {};
	const address = endpoint.remote || data.server_ip;
	return rows([
		[ _('认证状态'), data.message ],
		[ _('校园网接口'), data.interface ],
		[ _('实际设备'), data.device ],
		[ _('接口 MAC'), data.mac ],
		[ _('IPv4 地址'), (data.ipv4 || []).join(', ') ],
		[ _('IPv6 地址'), (data.ipv6 || []).join(', ') ],
		[ _('认证服务器地址'), address ],
		[ _('在线检测 TCP 端口'), endpoint.port || data.status_port ],
		[ _('登录 TCP 端口'), data.login_port ],
		[ _('上一次登录成功时间'), data.last_login ]
	]);
}

function traffic(value) {
	if (value == null || value === '')
		return null;
	return String(value) === '-1' ? _('不限量') : value + ' MB';
}

function accountRows(data) {
	return rows([
		[ _('在线终端数'), data.online_devices ],
		[ _('账户余额'), data.balance == null ? null : data.balance + ' 元' ],
		[ _('已用流量'), traffic(data.use_flow) ],
		[ _('剩余流量'), traffic(data.remain_flow) ],
		[ _('套餐流量'), traffic(data.give_flow) ],
		[ _('当前套餐'), data.curr_group ],
		[ _('套餐到期日'), data.due_date ],
		[ _('下周期套餐'), data.next_group ]
	]);
}

return view.extend({
	load() {
		return status().catch(() => ({ message: _('暂时无法读取认证状态') }));
	},

	render(current) {
		const map = new form.Map('blcu-portal', _('北语校园网'));
		const section = map.section(form.NamedSection, 'main', 'portal');
		section.tab('status', _('连接状态'));
		section.tab('settings', _('设置'));

		const details = E('table', { class: 'table', 'aria-live': 'polite' }, statusRows(current));
		const feedback = E('p', { role: 'status' });
		let checking = false;
		const refreshStatus = async () => {
			if (checking)
				return;
			checking = true;
			try {
				details.replaceChildren(...statusRows(await status()));
			} catch (error) {
				details.replaceChildren(...statusRows({ message: _('状态查询失败') }));
			} finally {
				checking = false;
			}
		};
		const refresh = E('button', { type: 'button', class: 'btn' }, _('刷新状态'));
		refresh.addEventListener('click', ui.createHandlerFn(this, refreshStatus));
		const manual = E('button', { type: 'button', class: 'btn cbi-button-action' }, _('单次认证'));
		manual.addEventListener('click', ui.createHandlerFn(this, async () => {
			try {
				const response = await login();
				feedback.textContent = response.message || _('未知');
			} catch (error) {
				showError(error);
			}
		}));

		const usage = E('table', { class: 'table' }, accountRows({}));
		const accountMessage = E('p', { role: 'status' });
		const refreshAccount = async () => {
			try {
				const data = await accountSummary();
				usage.replaceChildren(...accountRows(data));
				accountMessage.textContent = data.message || '';
			} catch (error) {
				accountMessage.textContent = _('账户信息查询失败');
			}
		};
		const updateAccount = E('button', { type: 'button', class: 'btn' }, _('刷新账户信息'));
		updateAccount.addEventListener('click', ui.createHandlerFn(this, refreshAccount));

		const statusOption = section.taboption('status', form.DummyValue, '_status');
		statusOption.render = () => E('div', { class: 'cbi-section' }, [
			details, E('p', {}, [ refresh, ' ', manual ]), feedback,
			E('h3', {}, _('校园网账户')), usage, accountMessage, updateAccount
		]);

		const network = section.taboption('settings', widgets.NetworkSelect, 'interface', _('校园网接口'));
		network.rmempty = false;
		network.multiple = false;
		network.nocreate = true;

		const ip = section.taboption('settings', form.Value, 'server_ip', _('认证服务器 IP 地址'),
			_('支持 IPv4 和 IPv6。留空时使用系统 DNS。'));
		ip.datatype = 'ipaddr("nomask")';

		const enabled = section.taboption('settings', form.Flag, 'enabled', _('自动检测并重连'),
			_('通过校园网 Portal 检测状态。连续确认离线后才重登，接口超时或状态未知时延后再查。'));
		enabled.rmempty = false;

		const interval = section.taboption('settings', form.Value, 'check_interval', _('检测间隔（秒）'));
		interval.datatype = 'range(15,3600)';
		interval.default = '60';
		interval.rmempty = false;
		interval.depends('enabled', '1');

		const threshold = section.taboption('settings', form.Value, 'offline_checks', _('触发重连的连续离线次数'));
		threshold.datatype = 'range(1,10)';
		threshold.default = '2';
		threshold.rmempty = false;
		threshold.depends('enabled', '1');

		const account = E('input', { type: 'text', class: 'cbi-input-text',
			autocomplete: 'username', maxlength: 60 });
		const password = E('input', { type: 'password', class: 'cbi-input-text',
			autocomplete: 'new-password' });
		const save = E('button', { type: 'button', class: 'btn cbi-button-action' }, _('保存校园网账号'));
		save.addEventListener('click', ui.createHandlerFn(this, async () => {
			try {
				const response = await credentials(account.value.trim(), password.value);
				if (!response.ok)
					throw new Error(response.message);
				password.value = '';
				account.value = '';
				ui.addNotification(null, E('p', {}, response.message), 'info');
			} catch (error) {
				showError(error);
			}
		}));

		const auth = section.taboption('settings', form.DummyValue, '_credentials');
		const controls = [
			E('p', {}, E('label', {}, [ _('校园网用户名'), ' ', account ])),
			E('p', {}, E('label', {}, [ _('校园网密码'), ' ', password ])),
			save
		];
		auth.render = () => E('div', { class: 'cbi-section' }, controls);

		poll.add(() => details.getClientRects().length ? refreshStatus() : null, 30);
		return map.render().then(node => {
			refreshAccount();
			return node;
		});
	}
});
