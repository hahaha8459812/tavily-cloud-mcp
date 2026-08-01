import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Form, Input, App as AntdApp } from 'antd'
import { LockOutlined, ThunderboltFilled } from '@ant-design/icons'
import { api, setToken, setSavedPassword, clearToken } from '../api/client'

interface LoginFormValues {
  password: string
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { message } = AntdApp.useApp()
  const [loading, setLoading] = useState(false)

  const handleFinish = async (values: LoginFormValues) => {
    setLoading(true)
    try {
      const { token } = await api.login(values.password)
      clearToken() // 避免旧 token 残留
      setToken(token)
      setSavedPassword(values.password) // 记住密码，下次打开自动登录
      message.success('登录成功')
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
      navigate(from ?? '/', { replace: true })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <ThunderboltFilled />
        </div>
        <div className="login-title">Tavily Cloud</div>
        <div className="login-subtitle">MCP 云端搜索管理控制台</div>
        <Form<LoginFormValues> onFinish={handleFinish} size="large">
          <Form.Item name="password" rules={[{ required: true, message: '请输入面板密码' }]}>
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="面板密码"
              autoComplete="current-password"
              autoFocus
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, marginTop: 28 }}>
            <Button type="primary" htmlType="submit" block loading={loading} style={{ height: 44 }}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  )
}
