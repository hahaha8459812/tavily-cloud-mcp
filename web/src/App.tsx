import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Layout, Menu, Drawer, Grid, Button, App as AntdApp, Spin } from 'antd'
import {
  DashboardOutlined,
  SettingOutlined,
  LogoutOutlined,
  ThunderboltOutlined,
  MenuOutlined,
  HistoryOutlined,
} from '@ant-design/icons'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import CallLogs from './pages/CallLogs'
import {
  api,
  getToken,
  setToken,
  clearToken,
  clearSavedPassword,
  getSavedPassword,
  SESSION_EXPIRED_EVENT,
} from './api/client'

const { Sider, Content } = Layout

/**
 * 鉴权守卫（含自动登录）：
 * - 已有 token：直接进入
 * - 无 token 但浏览器记住密码：静默调登录接口换取新 token 后进入（token 24h 过期后自动续）
 * - 无 token 且无记住密码：跳转登录页
 * - 会话中途失效（后端重启导致内存 session 丢失）：监听会话失效事件，用记住的密码重新登录
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false

    const autoLogin = async () => {
      if (getToken()) {
        setChecking(false)
        return
      }
      // token 缺失/过期：尝试用记住的密码自动登录
      const savedPassword = getSavedPassword()
      if (savedPassword) {
        try {
          const { token } = await api.login(savedPassword)
          if (!cancelled) {
            setToken(token)
          }
        } catch {
          // 密码已失效，清除后走登录页
          if (!cancelled) {
            clearSavedPassword()
            clearToken()
          }
        }
      }
      if (!cancelled) {
        setChecking(false)
      }
    }

    // 会话中途失效：重新触发自动登录（若记住密码有效则无缝恢复）
    const handleSessionExpired = () => {
      if (!cancelled) {
        setChecking(true)
        void autoLogin()
      }
    }

    void autoLogin()
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    return () => {
      cancelled = true
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    }
  }, [])

  if (checking) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spin size="large" />
      </div>
    )
  }

  if (!getToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return <>{children}</>
}

function PanelLayout() {
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const location = useLocation()
  const screens = Grid.useBreakpoint()
  // 移动端（<768px）：Sider 收进 Drawer，顶部用固定导航栏。
  // 用 `!== true` 判定：首屏 breakpoint 未就绪时为 undefined，按移动端渲染，
  // 避免手机首屏闪桌面侧边栏（桌面端在 breakpoint 就绪后数百毫秒内切回，影响极小）
  const isMobile = screens.md !== true
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleLogout = () => {
    clearToken()
    clearSavedPassword() // 退出同时清除记住的密码，避免下次自动登录
    message.success('已退出登录')
    navigate('/login')
  }

  const selectedKey = location.pathname.startsWith('/settings')
    ? '/settings'
    : location.pathname.startsWith('/call-logs')
      ? '/call-logs'
      : '/'

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '概览' },
    { key: '/call-logs', icon: <HistoryOutlined />, label: '调用记录' },
    { key: '/settings', icon: <SettingOutlined />, label: '参数配置' },
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      handleLogout()
      return
    }
    navigate(key)
    if (isMobile) {
      setDrawerOpen(false)
    }
  }

  // 桌面端：固定侧边栏
  const desktopSider = (
    <Sider width={216} className="panel-sider" theme="dark">
      <div className="panel-brand">
        <ThunderboltOutlined className="panel-brand-icon" />
        Tavily Cloud
      </div>
      <div style={{ padding: '16px 8px 8px' }}>
        <div
          style={{
            fontSize: 11,
            color: '#8a8aa3',
            textTransform: 'uppercase',
            letterSpacing: 1.2,
            padding: '0 12px 8px',
          }}
        >
          管理控制台
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '16px 8px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[]}
          items={[
            { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
          ]}
        />
      </div>
    </Sider>
  )

  // 移动端：顶部固定导航栏 + Drawer 菜单
  const mobileHeader = (
    <div className="panel-mobile-header">
      <div className="panel-brand panel-brand-mobile">
        <ThunderboltOutlined className="panel-brand-icon" />
        Tavily Cloud
      </div>
      <Button
        type="text"
        className="panel-mobile-menu-btn"
        icon={<MenuOutlined />}
        aria-label="打开菜单"
        onClick={() => setDrawerOpen(true)}
      />
    </div>
  )

  const mobileDrawer = (
    <Drawer
      placement="left"
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      className="panel-mobile-drawer"
      width={216}
      closable={false}
      styles={{ body: { padding: 0 } }}
    >
      <div className="panel-brand panel-brand-drawer">
        <ThunderboltOutlined className="panel-brand-icon" />
        Tavily Cloud
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={handleMenuClick}
        style={{ background: 'transparent' }}
      />
      <div className="panel-mobile-drawer-footer">
        <Button type="text" block icon={<LogoutOutlined />} onClick={handleLogout}>
          退出登录
        </Button>
      </div>
    </Drawer>
  )

  const content = (
    <Content>
      <div className="panel-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/call-logs" element={<CallLogs />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Content>
  )

  if (isMobile) {
    return (
      <Layout className="panel-layout">
        {mobileHeader}
        {mobileDrawer}
        {content}
      </Layout>
    )
  }

  return (
    <Layout className="panel-layout">
      {desktopSider}
      {content}
    </Layout>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <PanelLayout />
          </RequireAuth>
        }
      />
    </Routes>
  )
}
