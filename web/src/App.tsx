import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Layout, Menu, App as AntdApp, Spin } from 'antd'
import {
  DashboardOutlined,
  SettingOutlined,
  LogoutOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import { api, getToken, setToken, clearToken, clearSavedPassword } from './api/client'

const { Sider, Content } = Layout

/**
 * 鉴权守卫（含自动登录）：
 * - 已有 token：直接进入
 * - 无 token 但浏览器记住密码：静默调登录接口换取新 token 后进入（token 24h 过期后自动续）
 * - 无 token 且无记住密码：跳转登录页
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
      const savedPassword = localStorage.getItem('tavily_admin_password')
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
    void autoLogin()
    return () => {
      cancelled = true
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

  const handleLogout = () => {
    clearToken()
    clearSavedPassword() // 退出同时清除记住的密码，避免下次自动登录
    message.success('已退出登录')
    navigate('/login')
  }

  const selectedKey = location.pathname.startsWith('/settings') ? '/settings' : '/'

  return (
    <Layout className="panel-layout">
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
            items={[
              { key: '/', icon: <DashboardOutlined />, label: '概览' },
              { key: '/settings', icon: <SettingOutlined />, label: '参数配置' },
            ]}
            onClick={({ key }) => navigate(key)}
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
      <Content>
        <div className="panel-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Content>
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
