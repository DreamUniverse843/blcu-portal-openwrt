'use strict';
'require form';
'require network as netmodel';
'require poll';
'require rpc';
'require ui';
'require uci';
'require view';

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
const poolState = rpc.declare({ object: 'blcu-portal', method: 'pool', reject: true });
const poolSave = rpc.declare({
	object: 'blcu-portal', method: 'pool-save',
	params: [ 'interface', 'account', 'password', 'enabled' ], reject: true
});
const poolRemove = rpc.declare({
	object: 'blcu-portal', method: 'pool-remove', params: [ 'interface' ], reject: true
});
const ipv6State = rpc.declare({ object: 'blcu-portal', method: 'ipv6', reject: true });
const login = rpc.declare({ object: 'blcu-portal', method: 'login', reject: true });

function showError(error) {
	ui.addNotification(null, E('p', {}, error.message || String(error)));
}

function toolbar(...items) {
	return E('div', {
		class: 'blcu-actions',
		style: 'display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:.5rem 0 1rem'
	}, items);
}

function action(context, title, handler, style = 'action') {
	return E('button', {
		type: 'button',
		class: 'cbi-button cbi-button-' + style,
		click: ui.createHandlerFn(context, handler)
	}, title);
}

function panel(section, tab, name, title, ...nodes) {
	const option = section.taboption(tab, form.DummyValue, name, title);
	option.renderWidget = () => E('div', { class: 'blcu-panel' }, nodes);
}

function rows(entries) {
	return entries.map(([ label, value ]) => E('tr', { class: 'tr' }, [
		E('th', { class: 'td', scope: 'row' }, label),
		E('td', { class: 'td' }, value != null && value !== '' ? String(value) : '—')
	]));
}

function keyValues(entries) {
	return entries.map(([ label, value ]) => E('div', { class: 'blcu-key-value' }, [
		E('dt', {}, label),
		E('dd', {}, value != null && value !== '' ? String(value) : '—')
	]));
}

function card(title, actions, ...content) {
	return E('section', { class: 'blcu-state-card' }, [
		E('div', { class: 'blcu-card-header' }, [
			E('h3', {}, title),
			E('div', { class: 'blcu-card-actions' }, actions)
		]),
		...content
	]);
}

function prefixKey(upstream, prefix) {
	return [upstream.interface, prefix.class, prefix.prefix].join('|');
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
	return keyValues([
		[ _('插件版本'), data.version ],
		[ _('认证状态'), data.message ],
		[ _('连接方式'), data.connection_mode === 'pool' ? _('账号池') : _('单接口') ],
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
	return keyValues([
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
		return Promise.all([
			status().catch(() => ({ message: _('暂时无法读取认证状态') })),
			netmodel.getNetworks().catch(() => [])
		]);
	},

	render([current, availableNetworks]) {
		const map = new form.Map('blcu-portal', _('北语校园网'));
		const section = map.section(form.NamedSection, 'main', 'portal');
		section.tab('status', _('连接状态'));
		section.tab('connections', _('连接'));
		section.tab('ipv6', 'IPv6');
		section.tab('logs', _('日志'));
		section.tab('settings', _('设置'));

		if (window.location.pathname.includes('/admin/network/network/blcu-pool'))
			section.selected_tab = 'connections';

		const details = E('dl', { class: 'blcu-key-values', 'aria-live': 'polite' }, statusRows(current));
		const feedback = E('p', { role: 'status', class: 'blcu-feedback' });
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
		const refresh = action(this, _('刷新状态'), refreshStatus);
		const manual = action(this, _('单次认证'), async () => {
			try {
				const response = await login();
				feedback.textContent = response.message || _('未知');
			} catch (error) {
				showError(error);
			}
		}, 'apply');

		const usage = E('dl', { class: 'blcu-key-values' }, accountRows({}));
		const accountMessage = E('p', { role: 'status', class: 'blcu-feedback' });
		const refreshAccount = async () => {
			try {
				const data = await accountSummary();
				usage.replaceChildren(...accountRows(data));
				accountMessage.textContent = data.message || '';
			} catch (error) {
				accountMessage.textContent = _('账户信息查询失败');
			}
		};
		const updateAccount = action(this, _('刷新账户信息'), refreshAccount);
		const dashboardStyle = E('style', {}, `
			.blcu-dashboard { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr)); gap:1rem; align-items:start }
			.blcu-state-card { min-width:0; padding:.9rem 1rem; border:1px solid; border-color:var(--border-color-medium,rgba(128,128,128,.35)); border-radius:.45rem }
			.blcu-card-header { display:flex; flex-wrap:wrap; gap:.6rem; align-items:center; justify-content:space-between; margin:0 0 .5rem }
			.blcu-card-header > h3 { padding:0; margin:0; border:0; background:none; color:inherit; font-size:1.12rem; line-height:1.4 }
			.blcu-card-actions { display:flex; flex-wrap:wrap; align-items:center; gap:.4rem }
			.blcu-key-values { padding:0; margin:0; text-align:left; line-height:1.4 }
			.blcu-key-value { display:grid; grid-template-columns:minmax(8.5rem,38%) minmax(0,1fr); gap:.5rem; padding:.36rem 0 }
			.blcu-key-value + .blcu-key-value { border-top:1px solid; border-color:var(--border-color-medium,rgba(128,128,128,.25)) }
			.blcu-key-value > dt,.blcu-key-value > dd { margin:0; padding:0; text-align:left; overflow-wrap:anywhere }
			.blcu-key-value > dt { font-weight:600 }
			.blcu-feedback:empty { display:none }
			@media (max-width:380px) { .blcu-key-value { grid-template-columns:1fr; gap:.15rem } }
		`);
		panel(section, 'status', '_status', '', dashboardStyle,
			E('div', { class: 'blcu-dashboard' }, [
				card(_('主连接'), [ refresh, manual ], feedback, details),
				card(_('校园网账户'), [ updateAccount ], accountMessage, usage)
			]));

		const names = availableNetworks.map(item => item.getName()).filter(name => name !== 'loopback');
		const existing = current.fallback_interface || current.interface;
		if (existing && !names.includes(existing))
			names.push(existing);
		const network = section.taboption('connections', form.ListValue, '_uplink', _('校园网接口'),
			_('选中「使用账号池」并保存应用后，原来使用的接口也可以加入账号池。'));
		for (const name of names)
			network.value(name);
		network.value('@pool', _('使用账号池'));
		network.rmempty = false;
		network.cfgvalue = sectionId => {
			if (map.data.get('blcu-portal', sectionId, 'uplink_mode') === 'pool')
				return '@pool';
			return map.data.get('blcu-portal', sectionId, 'interface') || existing || 'wan';
		};
		network.write = (sectionId, selected) => {
			const pooled = selected === '@pool';
			map.data.set('blcu-portal', sectionId, 'uplink_mode', pooled ? 'pool' : 'single');
			map.data.set('blcu-portal', sectionId, 'pool_enabled', pooled ? '1' : '0');
			if (!pooled)
				map.data.set('blcu-portal', sectionId, 'interface', selected);
		};

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

		const poolTable = E('table', { class: 'table' });
		const poolFeedback = E('p', { role: 'status' });
		const interfaces = E('select', { class: 'cbi-input-select', 'aria-label': _('独立上联接口') }, [
			E('option', { value: '' }, _('选择独立上联')),
			...names.filter(name => name !== 'lan')
				.map(name => E('option', { value: name }, name))
		]);
		const poolUser = E('input', { type: 'text', class: 'cbi-input-text', 'aria-label': _('账号池用户名'),
			autocomplete: 'off', placeholder: _('校园网账号') });
		const poolPassword = E('input', { type: 'password', class: 'cbi-input-text', 'aria-label': _('账号池密码'),
			autocomplete: 'new-password', placeholder: _('新建账号时填写密码') });
		const poolEnabled = E('input', { type: 'checkbox' });
		poolEnabled.checked = true;

		let poolMode = current.connection_mode === 'pool';
		const reuseMain = E('input', { type: 'checkbox' });
		const reuseLabel = E('label', {}, [ reuseMain, ' ', _('沿用主连接账号') ]);
		const updateReuse = () => {
			reuseLabel.hidden = !poolMode || interfaces.value !== existing;
			if (reuseLabel.hidden)
				reuseMain.checked = false;
			poolUser.disabled = reuseMain.checked;
			poolPassword.disabled = reuseMain.checked;
		};
		interfaces.addEventListener('change', updateReuse);
		reuseMain.addEventListener('change', updateReuse);
		updateReuse();

		const resetPool = () => {
			interfaces.value = '';
			interfaces.disabled = false;
			poolUser.value = '';
			poolPassword.value = '';
			poolEnabled.checked = true;
			reuseMain.checked = false;
			updateReuse();
		};
		const refreshPool = async () => {
			try {
				const response = await poolState();
				const list = response.entries || [];
				poolMode = response.exclusive;
				updateReuse();
				poolTable.replaceChildren(
					E('tr', { class: 'tr table-titles' }, [
						_('接口'), _('校园网账号'), _('设备'), _('认证状态'), _('操作')
					].map(label => E('th', { class: 'th', scope: 'col' }, label))),
					...list.map(entry => {
						const state = entry.status || {};
						const buttons = toolbar(
							action(this, _('编辑'), () => {
								if (![...interfaces.options].some(option => option.value === entry.interface))
									interfaces.add(E('option', { value: entry.interface }, entry.interface));
								interfaces.value = entry.interface;
								interfaces.disabled = true;
								poolUser.value = entry.account;
								poolPassword.value = '';
								poolEnabled.checked = entry.enabled;
								reuseMain.checked = false;
								updateReuse();
								poolUser.focus();
							}),
							action(this, _('移除'), async () => {
								if (!window.confirm(_('移除此接口绑定的账号？')))
									return;
								const result = await poolRemove(entry.interface);
								if (!result.ok)
									throw new Error(result.message);
								resetPool();
								await refreshPool();
							}, 'remove')
						);
						return E('tr', { class: 'tr' }, [
							entry.interface, entry.account, state.device || '—', state.message || '—', buttons
						].map(value => E('td', { class: 'td' }, value)));
					})
				);
				poolFeedback.textContent = !response.enabled
					? _('账号池未启用。请在「校园网接口」选择「使用账号池」并保存应用。')
					: list.length ? '' : _('暂无额外上联账号');
			} catch (error) {
				poolFeedback.textContent = _('读取账号池失败');
			}
		};
		const savePool = action(this, _('保存账号绑定'), async () => {
			try {
				if (!interfaces.value)
					throw new Error(_('请选择独立上联接口'));
				const result = await poolSave(interfaces.value, reuseMain.checked ? ':main-credentials' : poolUser.value.trim(),
					poolPassword.value, poolEnabled.checked ? '1' : '0');
				if (!result.ok)
					throw new Error(result.message);
				resetPool();
				await refreshPool();
			} catch (error) {
				showError(error);
			}
		}, 'apply');
		panel(section, 'connections', '_pool', '', E('h3', {}, _('账号池')),
			E('p', {}, _('在「网络 → 接口」准备独立上联后，为每条上联绑定一个账号。编辑已有账号时可留空密码。')),
			toolbar(interfaces, poolUser, poolPassword, E('label', {}, [ poolEnabled, ' ', _('此接口使用账号池') ]), reuseLabel,
				savePool, action(this, _('取消编辑'), resetPool)),
			toolbar(action(this, _('刷新账号池'), refreshPool)), poolFeedback, poolTable);

		const upstreamInfo = E('div', { 'aria-live': 'polite' });
		const ipv6Feedback = E('p', { role: 'status', class: 'blcu-feedback' });
		const prefixInput = E('select', { class: 'cbi-input-select', 'aria-label': _('委派前缀') });
		const lanInput = E('select', { class: 'cbi-input-select', 'aria-label': _('下发到 LAN') });
		const choices = {
			slaac: { label: _('SLAAC（RA 自动配置）'), dhcpv6: 'disabled',
				slaac: '1', stateful: '0', flags: ['none'] },
			stateless: { label: _('SLAAC + 无状态 DHCPv6'), dhcpv6: 'server',
				slaac: '1', stateful: '0', flags: ['other-config'] },
			stateful: { label: _('有状态 DHCPv6 + RA'), dhcpv6: 'server',
				slaac: '0', stateful: '1', flags: ['managed-config', 'other-config'] }
		};
		const methodInput = E('select', { class: 'cbi-input-select', 'aria-label': _('下发方式') },
			Object.entries(choices).map(([key, mode]) => E('option', { value: key }, mode.label)));

		const stageIPv6 = action(this, _('暂存 IPv6 下发配置'), async () => {
			try {
				const fresh = await ipv6State();
				const uplinks = fresh.upstreams || [];
				const chosen = uplinks.find(upstream => upstream.up && upstream.prefixes.some(prefix =>
					prefix.length <= 64 && prefixKey(upstream, prefix) === prefixInput.value));
				if (!chosen)
					throw new Error(_('委派前缀已变化，请刷新上游状态后重新选择。'));
				const prefix = chosen.prefixes.find(item =>
					prefixKey(chosen, item) === prefixInput.value);
				const lan = lanInput.value;
				const network = uci.sections('network', 'interface').find(item => item['.name'] === lan);
				const dhcp = uci.sections('dhcp', 'dhcp').find(item => (item.interface || item['.name']) === lan);
				if (!network || network.proto !== 'static' || !dhcp ||
						uplinks.some(item => item.interface === lan || (network.device && item.device === network.device)))
					throw new Error(_('请选择已有 DHCP 配置的下游静态 LAN 接口。'));
				const mode = choices[methodInput.value];
				if (!mode)
					throw new Error(_('请选择 IPv6 下发方式。'));
				const sectionId = dhcp['.name'];
				uci.set('network', lan, 'ip6assign', '64');
				uci.set('network', lan, 'ip6class', [...new Set([ 'local', prefix.class ])]);
				uci.set('dhcp', sectionId, 'ra', 'server');
				uci.set('dhcp', sectionId, 'dhcpv6', mode.dhcpv6);
				uci.set('dhcp', sectionId, 'ra_slaac', mode.slaac);
				uci.set('dhcp', sectionId, 'ra_flags', mode.flags);
				uci.set('dhcp', sectionId, 'dhcpv6_na', mode.stateful);
				uci.set('dhcp', sectionId, 'dhcpv6_pd', '0');
				uci.set('dhcp', sectionId, 'ndp', 'disabled');
				await uci.save();
				await ui.changes.init();
				ipv6Feedback.textContent = _('已暂存，请核对待应用配置后点击「保存并应用」。');
			} catch (error) {
				showError(error);
			}
		}, 'apply');
		stageIPv6.disabled = true;
		const refreshIPv6 = async () => {
			try {
				const data = await ipv6State();
				const uplinks = data.upstreams || [];
				upstreamInfo.replaceChildren(...uplinks.map(upstream => E('div', { class: 'blcu-state-card' }, [
					E('h4', {}, upstream.interface + (upstream.device ? ' · ' + upstream.device : '')),
					E('dl', { class: 'blcu-key-values' }, keyValues([
						[ _('接口状态'), upstream.up ? _('已连接') : _('未连接') ],
						[ _('IPv6 地址'), upstream.addresses.join(', ') ],
						[ _('委派前缀（PD）'), upstream.prefixes.map(prefix => prefix.prefix).join(', ') || _('未获得') ],
						[ _('IPv6 默认路由'), upstream.default_route ? _('已有') : _('未检测到') ],
						[ _('IPv6 DNS'), upstream.dns.join(', ') ]
					]))
				])));
				if (!uplinks.length)
					upstreamInfo.append(E('p', {}, data.message || _('暂无校园网上游接口')));
				const before = prefixInput.value;
				const prefixes = uplinks.filter(upstream => upstream.up).flatMap(upstream => upstream.prefixes
					.filter(prefix => prefix.length <= 64)
					.map(prefix => E('option', { value: prefixKey(upstream, prefix) },
						upstream.interface + ' · ' + prefix.prefix)));
				prefixInput.replaceChildren(...prefixes);
				if ([...prefixInput.options].some(item => item.value === before))
					prefixInput.value = before;
				try {
					await Promise.all([uci.load('network'), uci.load('dhcp')]);
				} catch (error) {
					ipv6Feedback.textContent = _('当前会话不能编辑 LAN 和 DHCP 配置。');
					stageIPv6.disabled = true;
					return;
				}
				const currentLan = lanInput.value;
				const dhcpInterfaces = uci.sections('dhcp', 'dhcp').map(item => item.interface || item['.name']);
				const lan = uci.sections('network', 'interface')
					.filter(item => item.proto === 'static' && item['.name'] !== 'loopback' &&
						dhcpInterfaces.includes(item['.name']) &&
						!uplinks.some(upstream => upstream.interface === item['.name'] ||
							(item.device && item.device === upstream.device)));
				lanInput.replaceChildren(...lan.map(item => E('option', { value: item['.name'] }, item['.name'])));
				if ([...lanInput.options].some(item => item.value === currentLan))
					lanInput.value = currentLan;
				stageIPv6.disabled = !prefixes.length || !lan.length;
				ipv6Feedback.textContent = !prefixes.length ? _('上游暂未获得可下发的委派前缀。')
					: !lan.length ? _('未找到已有 DHCP 配置的下游 LAN 接口。') : '';
			} catch (error) {
				ipv6Feedback.textContent = _('读取 IPv6 上游状态失败');
				stageIPv6.disabled = true;
			}
		};
		panel(section, 'ipv6', '_ipv6', '',
			E('h3', {}, _('上游 IPv6')),
			toolbar(action(this, _('刷新上游状态'), refreshIPv6)), upstreamInfo,
			E('h3', {}, _('向 LAN 下发')),
			toolbar(E('label', {}, [ _('委派前缀'), ' ', prefixInput ]),
				E('label', {}, [ _('下发接口'), ' ', lanInput ]),
				E('label', {}, [ _('下发方式'), ' ', methodInput ]), stageIPv6),
			ipv6Feedback);

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
		panel(section, 'logs', '_logs', '', toolbar(action(this, _('刷新日志'), refreshLogs)),
			logFeedback, logTable);

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
		const save = action(this, _('保存主连接账号'), async () => {
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
		}, 'apply');

		panel(section, 'settings', '_version', '', E('p', {}, [
			_('插件版本'), ' ', E('strong', {}, current.version || '—')
		]));
		panel(section, 'settings', '_credentials', '', E('h3', {}, _('主连接账号')),
			toolbar(E('label', {}, [ _('校园网用户名'), ' ', account ]),
				E('label', {}, [ _('校园网密码'), ' ', password ]), save));

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
		const check = action(this, _('立即检查更新'), async () => {
			try {
				renderUpdate(await checkUpdate());
			} catch (error) {
				showError(error);
			}
		});
		panel(section, 'settings', '_update', '', toolbar(check), updateInfo);

		poll.add(() => details.getClientRects().length ? refreshStatus() : null, 30);
		return map.render().then(node => {
			refreshAccount();
			refreshLogs();
			refreshPool();
			refreshIPv6();
			updateState().then(renderUpdate).catch(() => renderUpdate({ message: _('无法读取更新状态') }));
			return node;
		});
	}
});
