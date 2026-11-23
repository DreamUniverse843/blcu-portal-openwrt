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
const readLogs = rpc.declare({ object: 'blcu-portal', method: 'logs', reject: true });
const updateState = rpc.declare({ object: 'blcu-portal', method: 'update', reject: true });
const checkUpdate = rpc.declare({ object: 'blcu-portal', method: 'check-update', reject: true });
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

function pathLabel(path) {
	const statuses = { online: _('已认证'), offline: _('未认证'), unknown: _('待确认') };
	const text = ['IPv' + path.family, statuses[path.state] || statuses.unknown];
	if (path.message)
		text.push(path.message);
	return text.join(' · ');
}

function statusRows(data) {
	const endpoint = data.endpoint || {};
	const address = endpoint.remote || data.server_ip;
	return rows([
		[ _('认证状态'), data.message ],
		[ _('地址族状态'), (data.paths || []).map(pathLabel).join(' / ') ],
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
		section.tab('connections', _('连接'));
		section.tab('logs', _('日志'));
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

		const network = section.taboption('connections', widgets.NetworkSelect, 'interface', _('校园网接口'));
		network.rmempty = false;
		network.multiple = false;
		network.nocreate = true;

		const ip = section.taboption('connections', form.Value, 'server_ip', _('认证服务器 IP 地址'),
			_('支持 IPv4 和 IPv6。留空时使用系统 DNS。'));
		ip.datatype = 'ipaddr("nomask")';

		const addressMode = section.taboption('connections', form.ListValue, 'address_mode', _('连接模式'),
			_('双栈使用同一个账号和接口。客户端分别检查 IPv4 和 IPv6。'));
		addressMode.value('auto', _('自动（沿用现有地址族选择）'));
		addressMode.value('ipv4', _('仅 IPv4'));
		addressMode.value('ipv6', _('仅 IPv6'));
		addressMode.value('dual', _('IPv4 和 IPv6 双栈'));
		addressMode.default = 'auto';
		addressMode.rmempty = false;

		const ipv6 = section.taboption('connections', form.Value, 'server_ipv6', _('IPv6 认证服务器'),
			_('可选。未填写时使用与 IPv6 匹配的认证地址或系统 DNS。'));
		ipv6.datatype = 'ip6addr("nomask")';
		ipv6.depends('address_mode', 'dual');
		ipv6.depends('address_mode', 'ipv6');

		const logTable = E('table', { class: 'table' });
		const logFeedback = E('p', { role: 'status' });
		const events = {
			attempt: _('发起认证'),
			success: _('认证成功'),
			failed: _('认证失败'),
			unconfirmed: _('认证结果待确认'),
			state: _('状态变化'),
			check_failed: _('状态检测失败')
		};
		const refreshLogs = async () => {
			try {
				const response = await readLogs();
				const entries = response.entries || [];
				logTable.replaceChildren(
					E('tr', { class: 'tr table-titles' }, [
						_('时间'), _('接口'), _('地址族'), _('事件'), _('原因或结果')
					].map(label => E('th', { class: 'th', scope: 'col' }, label))),
					...entries.map(entry => E('tr', { class: 'tr' }, [
						entry.time, entry.interface, entry.family ? 'IPv' + entry.family : '—',
						events[entry.event] || '—', entry.reason || '—'
					].map(value => E('td', { class: 'td' }, String(value)))))
				);
				logFeedback.textContent = entries.length ? '' : _('暂无认证日志');
			} catch (error) {
				logFeedback.textContent = _('认证日志读取失败');
			}
		};
		const logRefresh = E('button', { type: 'button', class: 'btn' }, _('刷新日志'));
		logRefresh.addEventListener('click', ui.createHandlerFn(this, refreshLogs));
		const logs = section.taboption('logs', form.DummyValue, '_logs');
		logs.render = () => E('div', { class: 'cbi-section' }, [ logRefresh, logFeedback, logTable ]);

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

		const updateEnabled = section.taboption('settings', form.Flag, 'update_enabled', _('自动检查更新'));
		updateEnabled.default = '1';
		updateEnabled.rmempty = false;

		const updateHours = section.taboption('settings', form.Value, 'update_hours', _('更新检查间隔（小时）'));
		updateHours.datatype = 'range(1,168)';
		updateHours.default = '24';
		updateHours.depends('update_enabled', '1');

		const source = section.taboption('settings', form.Value, 'update_source', _('更新源链接'),
			_('可以填写 GitHub Releases 页面或兼容的 HTTPS 发布接口。留空时使用插件公开仓库。'));
		source.placeholder = 'https://github.com/DreamUniverse843/blcu-portal-openwrt/releases';
		source.validate = (_, value) => {
			if (!value)
				return true;
			try {
				const url = new URL(value);
				if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash)
					return true;
			} catch (error) {}
			return _('请输入不带身份信息和查询参数的 HTTPS 链接。');
		};

		const updateInfo = E('div', { role: 'status' });
		const renderUpdate = data => {
			updateInfo.replaceChildren(E('table', { class: 'table' }, rows([
				[ _('已安装版本'), data.current ],
				[ _('最新版本'), data.latest ],
				[ _('最后检查时间'), data.checked_at ],
				[ _('检查结果'), data.message || _('尚未检查') ]
			])));
			if (data.link)
				updateInfo.append(E('p', {}, E('a', {
					href: data.link, target: '_blank', rel: 'noopener noreferrer'
				}, _('打开发布页面'))));
		};
		const check = E('button', { type: 'button', class: 'btn' }, _('立即检查更新'));
		check.addEventListener('click', ui.createHandlerFn(this, async () => {
			try {
				renderUpdate(await checkUpdate());
			} catch (error) {
				showError(error);
			}
		}));
		const update = section.taboption('settings', form.DummyValue, '_update');
		update.render = () => E('div', { class: 'cbi-section' }, [ check, updateInfo ]);

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
			refreshLogs();
			updateState().then(renderUpdate).catch(() => renderUpdate({ message: _('无法读取更新状态') }));
			return node;
		});
	}
});
