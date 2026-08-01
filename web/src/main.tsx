import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

/**
 * 现代暗色主题。
 * 设计语言：深空底色 + 靛蓝→紫→品红渐变强调 + 玻璃态卡片 + 精致间距。
 * 关键：AntD 暗色下浮层（Select/Modal/Popover）必须显式配置深色背景，
 * 否则会出现"选项浅背景+浅文字"导致看不清。
 */
const theme = {
  token: {
    // 品牌渐变：indigo -> violet -> fuchsia
    colorPrimary: '#6366f1',
    colorInfo: '#6366f1',
    colorLink: '#818cf8',
    colorSuccess: '#34d399',
    colorWarning: '#fbbf24',
    colorError: '#f87171',
    // 底色：近黑深空
    colorBgBase: '#09090f',
    colorBgContainer: '#11111a',
    colorBgElevated: '#181825',
    colorBgLayout: '#09090f',
    // 文字
    colorTextBase: '#e4e4f0',
    colorText: '#e4e4f0',
    colorTextSecondary: '#9d9db3',
    colorTextTertiary: '#6d6d85',
    // 边框
    colorBorder: '#23233a',
    colorBorderSecondary: '#1a1a2e',
    // 控件交互背景（Select 选项选中+悬停态会优先用 controlItemBgActiveHover）
    controlItemBgActive: 'rgba(99, 102, 241, 0.25)',
    controlItemBgActiveHover: 'rgba(129, 140, 248, 0.35)',
    controlItemBgHover: 'rgba(99, 102, 241, 0.15)',
    // 圆角
    borderRadius: 10,
    borderRadiusLG: 14,
    // 字体
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
  },
  components: {
    Layout: {
      siderBg: 'rgba(13, 13, 22, 0.8)',
      headerBg: 'transparent',
      bodyBg: 'transparent',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(217, 70, 239, 0.15))',
      darkItemSelectedColor: '#c7d2fe',
      darkItemHoverBg: 'rgba(99, 102, 241, 0.1)',
      darkItemColor: '#9d9db3',
      darkItemHoverColor: '#e4e4f0',
      darkItemSelectedBgRaw: 'rgba(99, 102, 241, 0.18)',
      itemBorderRadius: 8,
      itemHeight: 44,
      itemMarginInline: 8,
    },
    Card: {
      colorBgContainer: 'rgba(17, 17, 26, 0.85)',
      colorBorderSecondary: 'rgba(99, 102, 241, 0.14)',
    },
    Table: {
      colorBgContainer: 'transparent',
      headerBg: 'rgba(24, 24, 37, 0.6)',
      colorBorderSecondary: 'rgba(35, 35, 58, 0.5)',
      headerColor: '#9d9db3',
      rowHoverBg: 'rgba(99, 102, 241, 0.06)',
    },
    Select: {
      colorBgContainer: '#14141f',
      colorBgElevated: '#181825',
      optionSelectedBg: 'rgba(99, 102, 241, 0.35)',
      optionSelectedColor: '#ffffff',
      optionActiveBg: 'rgba(99, 102, 241, 0.2)',
      selectorBg: '#14141f',
      optionSelectedFontWeight: 600,
    },
    Input: {
      colorBgContainer: '#14141f',
      activeBorderColor: '#818cf8',
      hoverBorderColor: '#6366f1',
      activeShadow: '0 0 0 3px rgba(99, 102, 241, 0.15)',
    },
    InputNumber: {
      colorBgContainer: '#14141f',
    },
    Modal: {
      contentBg: '#14141f',
      headerBg: '#14141f',
      footerBg: '#14141f',
    },
    Popconfirm: {
      colorBgElevated: '#181825',
    },
    Progress: {
      remainingColor: 'rgba(255, 255, 255, 0.06)',
    },
    Button: {
      primaryShadow: '0 4px 16px rgba(99, 102, 241, 0.35)',
      defaultBg: '#14141f',
      defaultBorderColor: '#2a2a44',
      defaultColor: '#e4e4f0',
    },
    Tabs: {
      inkBarColor: '#818cf8',
      itemSelectedColor: '#e4e4f0',
      itemHoverColor: '#c7d2fe',
    },
    Tag: {
      defaultBg: 'rgba(99, 102, 241, 0.12)',
    },
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={theme}>
      <AntdApp>
        <BrowserRouter basename="/admin">
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
)
