// DSH Mobile Remote — 桌面 GUI 客户端模块
// 在 dsh 设置页注册"连接移动端设备"页：显示供手机 App 扫码连接的二维码。
//
// 打包形态：window.__ModuleLoader__.load({ id, factory })（dsh-client-modules 约定）。
// 手写 React.createElement（无 JSX/构建链），依赖由 dsh 客户端运行时提供。
// 数据来源：GET /m/api/qr-config（仅 loopback 可访问，返回地址+口令）。

window.__ModuleLoader__.load({
	id: "dsh-mobile-remote",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		var react = require("react");
		var jsxRuntime = require("react/jsx-runtime");

		var useState = react.useState;
		var useEffect = react.useEffect;

		/** 所需服务：slots（设置页 slot 注册）。 */
		exports.inject = ["slots"];

		var QR_CONFIG = "/m/api/qr-config";
		var QR_IMAGE = "/m/qr.png";

		var rowStyle = {
			display: "flex",
			alignItems: "center",
			gap: "10px",
			padding: "10px 0",
			borderBottom: "1px solid var(--dsw-alias-divider-strong, rgba(128,128,128,.18))",
			fontSize: "13.5px",
		};
		var btnStyle = {
			marginLeft: "auto",
			flex: "none",
			padding: "4px 12px",
			borderRadius: "8px",
			border: "1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.35))",
			background: "none",
			cursor: "pointer",
			font: "inherit",
			fontSize: "12px",
			color: "inherit",
		};
		/** 二维码地址页签：未选中态（透明底、描边）。 */
		var tabStyle = {
			padding: "6px 14px",
			borderRadius: "999px",
			border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28))",
			background: "transparent",
			cursor: "pointer",
			font: "inherit",
			fontSize: "12.5px",
			color: "var(--dsw-alias-label-secondary, #888)",
		};
		/** 二维码地址页签：选中态（主色填充）。 */
		var tabActiveStyle = {
			padding: "6px 14px",
			borderRadius: "999px",
			border: "1px solid var(--dsw-alias-button-primary-fill, #4c6ef5)",
			background: "var(--dsw-alias-button-primary-fill, #4c6ef5)",
			cursor: "pointer",
			font: "inherit",
			fontSize: "12.5px",
			color: "var(--dsw-alias-label-primary-foreground, #fff)",
		};

		function toast(text) {
			var el = document.getElementById("dsh-mr-toast");
			if (!el) {
				el = document.createElement("div");
				el.id = "dsh-mr-toast";
				el.style.cssText =
					"position:fixed;left:50%;bottom:48px;transform:translateX(-50%);" +
					"background:rgba(31,35,41,.92);color:#fff;border-radius:999px;" +
					"padding:8px 16px;font-size:13px;z-index:9999;opacity:0;" +
					"transition:opacity .2s;pointer-events:none;";
				document.body.appendChild(el);
			}
			el.textContent = text;
			el.style.opacity = "1";
			clearTimeout(el._h);
			el._h = setTimeout(function () {
				el.style.opacity = "0";
			}, 1600);
		}

		function fallbackCopy(text) {
			// 非安全上下文（http 局域网 IP）下 Clipboard API 不可用，用 textarea + execCommand 降级
			var ta = document.createElement("textarea");
			ta.value = text;
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand("copy");
			} catch (_) {
				/* 忽略 */
			}
			ta.remove();
		}

		function copyText(text) {
			var done = function () {
				toast("已复制");
			};
			if (navigator.clipboard && window.isSecureContext) {
				navigator.clipboard.writeText(text).then(
					done,
					function () {
						fallbackCopy(text);
						done();
					}
				);
			} else {
				fallbackCopy(text);
				done();
			}
		}

		/** 复制访问口令：60 秒后自动清空剪贴板（口令是唯一凭据，防其他应用读取；尽力而为）。 */
		function copyToken(token) {
			copyText(token);
			setTimeout(function () {
				try {
					if (navigator.clipboard && window.isSecureContext) {
						navigator.clipboard.readText().then(function (t) {
							if (t === token) navigator.clipboard.writeText("");
						});
					}
				} catch (_) {
					/* 非安全上下文等场景尽力而为 */
				}
			}, 60000);
		}

		/** 解析 URL 主机（含端口）。 */
		function hostOf(url) {
			try {
				return new URL(url).host;
			} catch (_) {
				return String(url ?? "");
			}
		}

		/** 提取主机里的 IP（去端口 / 去 IPv6 方括号），域名原样返回。 */
		function ipOf(url) {
			var host = hostOf(url);
			if (host.indexOf("[") === 0) {
				var end = host.indexOf("]");
				return end >= 0 ? host.slice(1, end) : host;
			}
			var idx = host.lastIndexOf(":");
			if (idx >= 0 && host.indexOf(":") === idx) return host.slice(0, idx);
			return host;
		}

		/** 回环地址（手机扫了也连不上，二维码页签排除）。 */
		function isLoopbackUrl(url) {
			var ip = ipOf(url);
			return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
		}

		/** 地址类别 → 页签文案（与 lib/index.js privateFirst 排序口径一致）。 */
		function labelOf(url) {
			if (isLoopbackUrl(url)) return "本机";
			var ip = ipOf(url);
			var o = ip.split(".");
			if (o.length !== 4) return "其他";
			var a = Number(o[0]);
			var b = Number(o[1]);
			if (Number.isNaN(a) || Number.isNaN(b)) return "其他";
			if (a === 10 || (a === 192 && b === 168)) return "内网";
			if (a === 172 && b >= 16 && b <= 31) return "组网";
			if (a === 100 && b >= 64 && b <= 127) return "Tailscale";
			return "其他";
		}

		/** 构造二维码页签（非回环地址），同名类别追加主机以区分。 */
		function buildQrTabs(urls) {
			var counts = {};
			urls.forEach(function (u) {
				var l = labelOf(u);
				counts[l] = (counts[l] || 0) + 1;
			});
			return urls.map(function (u) {
				var l = labelOf(u);
				return { url: u, label: counts[l] > 1 ? l + " " + hostOf(u) : l };
			});
		}

		/**
		 * 设置页 section：连接移动端设备。
		 * 挂载后从 /m/api/qr-config 拉取地址与口令，渲染二维码 + 连接信息。
		 */
		function MobileDeviceSection() {
			var state = useState({ status: "loading", urls: [], token: "" });
			var data = state[0];
			var setData = state[1];
			var sel = useState(null);
			var selected = sel[0];
			var setSelected = sel[1];

			useEffect(function () {
				var alive = true;
				fetch(QR_CONFIG, { headers: { accept: "application/json" } })
					.then(function (res) {
						if (!res.ok) throw new Error("HTTP " + res.status);
						return res.json();
					})
					.then(function (body) {
						if (!alive) return;
						var urls = Array.isArray(body.urls) ? body.urls : [];
						// v3.0.0 review：path 从 qr-config 读取（不再硬编码 /m——插件挂载路径可配置）
						setData({ status: "ready", urls: urls, token: String(body.token ?? ""), basePath: String(body.path || "/m") });
					})
					.catch(function (err) {
						if (!alive) return;
						setData({
							status: "error",
							urls: [],
							token: "",
							message: String(err?.message ?? err),
						});
					});
				return function () {
					alive = false;
				};
			}, []);

			if (data.status === "loading") {
				return jsxRuntime.jsx("div", { style: { padding: "20px 0", color: "var(--dsw-alias-label-secondary, #888)" }, children: "加载中…" });
			}
			if (data.status === "error") {
				return jsxRuntime.jsx("div", {
					style: { padding: "20px 0", color: "var(--dsw-alias-text-danger, #e5484d)" },
					children: "无法获取连接信息：" + data.message + "（确认 dsh-mobile-remote 插件已启用，且路径为 /m）",
				});
			}

			// v3.1.6：页签切换——下方可能同时列出内网/组网（外网）等多个地址，
			// 二维码默认仍选「首个非回环」地址，用户可在页签里改选要编码的链接。
			var targets = data.urls.filter(function (u) {
				return !isLoopbackUrl(u);
			});
			var defaultTarget = targets[0] ?? data.urls[0] ?? "http://127.0.0.1:3080";
			var qrTarget = selected != null && data.urls.indexOf(selected) >= 0 ? selected : defaultTarget;
			var tabs = buildQrTabs(targets);
			// v3.0.0 review：二维码 URL 携带挂载路径（App 端解析后使用，不再写死 /m）
			var mount = String(data.basePath || "/m").replace(/\/+$/, "");
			var qrPayload = "DSHREMOTE|" + qrTarget + mount + "|" + data.token;
			var qrSrc = mount + "/qr.png?text=" + encodeURIComponent(qrPayload);

			return jsxRuntime.jsx("div", {
				style: { display: "flex", flexDirection: "column", gap: "6px", padding: "4px 0 16px" },
				children: [
					jsxRuntime.jsx("div", {
						style: { fontSize: "13px", color: "var(--dsw-alias-label-secondary, #888)", lineHeight: "1.6" },
						children: "用手机 DSH Remote App 扫描下方二维码，自动填入电脑地址与访问口令，即可远程发消息、看进度、收通知、审批决策。",
					}),
					data.token
						? null
						: jsxRuntime.jsx("div", {
								style: {
									padding: "10px 12px",
									borderRadius: "8px",
									background: "rgba(229,72,77,.12)",
									border: "1px solid rgba(229,72,77,.4)",
									color: "var(--dsw-alias-text-danger, #e5484d)",
									fontSize: "12.5px",
									lineHeight: "1.6",
								},
								children:
									"⚠️ 访问口令未启用：同一网络内任何设备都能连接并控制 agent，建议立即在 cordis.patch.yml 配置 authToken 后重启。",
							}),
					jsxRuntime.jsx("div", {
						style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "14px 0" },
						children: [
							tabs.length > 1
								? jsxRuntime.jsx("div", {
										style: { display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" },
										children: tabs.map(function (t) {
											var active = t.url === qrTarget;
											return jsxRuntime.jsx(
												"button",
												{
													key: t.url,
													type: "button",
													title: t.url,
													onClick: function () {
														setSelected(t.url);
													},
													style: active ? tabActiveStyle : tabStyle,
													children: t.label,
												}
											);
										}),
								  })
								: null,
							jsxRuntime.jsx("img", {
								key: qrTarget,
								src: qrSrc,
								alt: "连接二维码",
								style: { width: 216, height: 216, borderRadius: "12px", background: "#fff", padding: 8 },
							}),
							jsxRuntime.jsx("div", {
								style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #aaa)" },
								children: "打开 App → 扫码连接 → 对准本二维码",
							}),
							tabs.length > 1
								? jsxRuntime.jsx("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: "6px",
											fontSize: "12px",
											color: "var(--dsw-alias-label-secondary, #888)",
											maxWidth: "100%",
											textAlign: "center",
										},
										children: [
											jsxRuntime.jsx("span", { children: "当前二维码：" }),
											jsxRuntime.jsx("span", { style: { wordBreak: "break-all", fontFamily: "monospace" }, children: qrTarget }),
										],
								  })
								: null,
						],
					}),
					jsxRuntime.jsx("div", { style: { fontSize: "13px", fontWeight: 600, margin: "8px 0 2px" }, children: "连接信息" }),
					data.urls.map(function (u) {
						return jsxRuntime.jsx(
							"div",
							{
								style: rowStyle,
								children: [
									jsxRuntime.jsx("span", { style: { wordBreak: "break-all", fontFamily: "monospace", fontSize: "12.5px" }, children: u }),
									jsxRuntime.jsx("button", { style: btnStyle, onClick: function () { copyText(u); }, children: "复制" }),
								],
							},
							u
						);
					}),
					jsxRuntime.jsx(
						"div",
						{
							style: rowStyle,
							children: [
								jsxRuntime.jsx("span", { children: "访问口令" }),
								jsxRuntime.jsx(
									"span",
									{
										style: { fontFamily: "monospace", fontSize: "12px", opacity: 0.75 },
										children: data.token
											? data.token.slice(0, 6) + "…" + data.token.slice(-4)
											: "未启用（局域网/内网环境）",
									}
								),
								data.token
									? jsxRuntime.jsx("button", {
											style: btnStyle,
											onClick: function () { copyToken(data.token); },
											children: "复制",
										})
									: null,
							],
						}
					),
					jsxRuntime.jsx("div", {
						style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #aaa)", marginTop: "6px" },
						children: "二维码包含访问口令，仅在本机显示；请勿截屏转发。App 与手机浏览器（/m 网页）共用同一连接。",
					}),
				],
			});
		}

		/** 注册设置页 section（id: mobile-device）。 */
		function apply(ctx) {
			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register(
					{
						name: "settings.section",
						id: "mobile-device",
						order: 90,
						label: "连接移动端设备",
					},
					MobileDeviceSection
				);
			});
		}
		exports.apply = apply;

		return module.exports;
	},
});
