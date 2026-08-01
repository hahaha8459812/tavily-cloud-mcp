/**
 * 获取 Tavily 官网 appSession Cookie（用于面板查询实时额度）。
 *
 * 使用方式（在浏览器里操作，无需安装任何东西）：
 * 1. 打开 https://app.tavily.com 并登录。
 * 2. 按 F12 打开开发者工具 → 切到 Console（控制台）标签。
 * 3. 把下面"===== 从这里复制开始 ====="到"===== 复制到这里结束 ====="之间的内容
 *    整体粘贴进 Console，按回车执行。
 * 4. 脚本会自动把 appSession cookie 复制到剪贴板，并在控制台打印出来。
 * 5. 把复制的值粘贴到面板「添加密钥」或「配置 Token」即可显示实时额度。
 *
 * 说明：
 * - 如果提示"未找到 appSession"：确认你已登录 app.tavily.com，且当前页面就是 app.tavily.com，
 *   然后刷新一次页面再执行。
 * - cookie 是敏感登录凭据，请勿外泄给他人。
 */

(() => {
  // ===== 从这里复制开始 =====
  const match = document.cookie.match(/(?:^|; )appSession=([^;]+)/);
  if (!match) {
    console.warn(
      "%c未找到 appSession Cookie。请确认：1) 已登录 app.tavily.com；2) 当前页面是 app.tavily.com；3) 刷新一次再试。",
      "color:#e67e22;font-size:12px",
    );
    return;
  }

  const value = decodeURIComponent(match[1]);

  // 优先用 DevTools 内置 copy()，不可用时退回 Clipboard API
  const done = () => {
    console.log("%c✅ 已复制 appSession 到剪贴板，可直接粘贴到面板。", "color:#27ae60;font-weight:bold");
    console.log("%c" + value, "font-size:10px;word-break:break-all;color:#3498db");
  };

  try {
    if (typeof copy === "function") {
      copy(value);
      done();
      return;
    }
  } catch {
    /* 忽略，走 Clipboard API */
  }

  navigator.clipboard
    .writeText(value)
    .then(done)
    .catch(() => {
      // 剪贴板不可用（非 https 或权限拒绝）：直接打印，手动复制
      console.log("%c无法自动复制，请手动选择下面内容复制：", "color:#e67e22");
      console.log(value);
    });
  // ===== 复制到这里结束 =====
})();
