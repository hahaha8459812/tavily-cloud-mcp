import { useEffect, useState } from 'react'
import { Card, Form, Switch, InputNumber, Select, Input, Button, Divider, Space, App as AntdApp } from 'antd'
import { SaveOutlined, LockOutlined, KeyOutlined } from '@ant-design/icons'
import { api } from '../api/client'

interface SettingsFormValues {
  // Search 面板参数（AI 不可修改）
  include_answer: string
  include_raw_content: string
  include_images: boolean
  include_image_descriptions: boolean
  include_favicon: boolean
  chunks_per_source: number | null
  include_domains: string
  exclude_domains: string
  country: string
  auto_parameters: boolean
  // Extract/Crawl 面板参数
  extract_include_images: boolean
  extract_include_favicon: boolean
  extract_depth: string
  extract_format: string
  // MCP 通道鉴权（H1）
  mcp_auth_enabled: boolean
  mcp_auth_api_key: string
}

interface PasswordFormValues {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

export default function Settings() {
  const { message } = AntdApp.useApp()
  const [form] = Form.useForm<SettingsFormValues>()
  const [passwordForm] = Form.useForm<PasswordFormValues>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const loadConfig = async () => {
    setLoading(true)
    try {
      const config = await api.getConfig()
      const search = config.panelSearch as Record<string, unknown>
      const extract = config.panelExtractCrawl as Record<string, unknown>
      const mcpAuth = config.mcpAuth ?? { enabled: false, apiKey: '' }
      form.setFieldsValue({
        include_answer: (search.include_answer as string) ?? 'false',
        include_raw_content: (search.include_raw_content as string) ?? 'false',
        include_images: (search.include_images as boolean) ?? false,
        include_image_descriptions: (search.include_image_descriptions as boolean) ?? false,
        include_favicon: (search.include_favicon as boolean) ?? false,
        chunks_per_source: (search.chunks_per_source as number) ?? null,
        include_domains: Array.isArray(search.include_domains) ? (search.include_domains as string[]).join(', ') : '',
        exclude_domains: Array.isArray(search.exclude_domains) ? (search.exclude_domains as string[]).join(', ') : '',
        country: (search.country as string) ?? '',
        auto_parameters: (search.auto_parameters as boolean) ?? false,
        extract_include_images: (extract.include_images as boolean) ?? false,
        extract_include_favicon: (extract.include_favicon as boolean) ?? false,
        extract_depth: (extract.extract_depth as string) ?? 'basic',
        extract_format: (extract.format as string) ?? 'markdown',
        mcp_auth_enabled: mcpAuth.enabled ?? false,
        mcp_auth_api_key: mcpAuth.apiKey ?? '',
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async (values: SettingsFormValues) => {
    setSaving(true)
    try {
      await api.saveConfig(
        {
          include_answer: values.include_answer,
          include_raw_content: values.include_raw_content,
          include_images: values.include_images,
          include_image_descriptions: values.include_image_descriptions,
          include_favicon: values.include_favicon,
          chunks_per_source: values.chunks_per_source ?? undefined,
          include_domains: values.include_domains
            ? values.include_domains.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined,
          exclude_domains: values.exclude_domains
            ? values.exclude_domains.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined,
          country: values.country || undefined,
          auto_parameters: values.auto_parameters,
        },
        {
          include_images: values.extract_include_images,
          include_favicon: values.extract_include_favicon,
          extract_depth: values.extract_depth,
          format: values.extract_format,
        },
        {
          enabled: values.mcp_auth_enabled,
          apiKey: values.mcp_auth_api_key.trim(),
        },
      )
      message.success('配置已保存，立即生效')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async (values: PasswordFormValues) => {
    setSavingPassword(true)
    try {
      await api.changePassword(values.oldPassword, values.newPassword)
      message.success('密码已修改，请牢记新密码')
      passwordForm.resetFields()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '修改失败')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <Card className="glass-card" title="面板管控参数" loading={loading}>
      <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', color: '#9d9db3', fontSize: 13 }}>
        以下参数<b style={{ color: '#c7d2fe' }}>不对 AI 暴露</b>，仅由面板统一配置，保存后立即生效（无需重启）。
      </div>
      <Form form={form} layout="vertical" onFinish={handleSave} style={{ maxWidth: 640 }}>
        <Divider>搜索参数（Search）</Divider>
        <Form.Item name="include_answer" label="附带 LLM 答案">
          <Select
            options={[
              { value: 'false', label: '关闭' },
              { value: 'true', label: '快速答案（basic）' },
              { value: 'basic', label: '基础答案' },
              { value: 'advanced', label: '详细答案' },
            ]}
          />
        </Form.Item>
        <Form.Item name="include_raw_content" label="附带原始内容">
          <Select
            options={[
              { value: 'false', label: '关闭' },
              { value: 'markdown', label: 'Markdown 格式' },
              { value: 'text', label: '纯文本' },
            ]}
          />
        </Form.Item>
        <Form.Item name="include_images" label="包含图片" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="include_image_descriptions" label="包含图片描述" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="include_favicon" label="包含站点图标" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="chunks_per_source" label="每来源内容片段数（1-5）">
          <InputNumber min={1} max={5} style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="include_domains" label="仅在这些域名内搜索（逗号分隔）">
          <Input placeholder="example.com, blog.example.com" />
        </Form.Item>
        <Form.Item name="exclude_domains" label="排除这些域名（逗号分隔）">
          <Input placeholder="spam.com, ads.com" />
        </Form.Item>
        <Form.Item name="country" label="国家加权（小写英文）">
          <Input placeholder="china / united states / 留空不设" />
        </Form.Item>
        <Form.Item name="auto_parameters" label="自动配置搜索参数" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Divider>提取/爬取参数（Extract / Crawl）</Divider>
        <Form.Item name="extract_depth" label="提取深度">
          <Select
            options={[
              { value: 'basic', label: '基础（1 积分/5 URL）' },
              { value: 'advanced', label: '高级（2 积分/5 URL，含表格）' },
            ]}
          />
        </Form.Item>
        <Form.Item name="extract_format" label="内容格式">
          <Select
            options={[
              { value: 'markdown', label: 'Markdown' },
              { value: 'text', label: '纯文本' },
            ]}
          />
        </Form.Item>
        <Form.Item name="extract_include_images" label="包含图片" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="extract_include_favicon" label="包含站点图标" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Divider>MCP 通道鉴权</Divider>
        <Form.Item
          name="mcp_auth_enabled"
          label="启用 MCP 鉴权"
          valuePropName="checked"
          extra="开启后，MCP 客户端连接必须携带 Authorization: Bearer <密钥>，防止云端公开访问消耗 Tavily 额度"
        >
          <Switch />
        </Form.Item>
        <Form.Item
          name="mcp_auth_api_key"
          label="MCP 共享密钥"
          rules={[
            ({ getFieldValue }) => ({
              validator: (_, value) => {
                if (!getFieldValue('mcp_auth_enabled')) return Promise.resolve()
                const key = (value ?? '').trim()
                return key.length >= 8
                  ? Promise.resolve()
                  : Promise.reject(new Error('开启 MCP 鉴权时，共享密钥至少 8 位'))
              },
            }),
          ]}
          extra="请设置至少 8 位的随机字符串，并告知你的 MCP 客户端"
        >
          <Input.Password placeholder="输入 MCP 共享密钥" autoComplete="new-password" />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
            保存配置
          </Button>
          <Button onClick={() => form.resetFields()}>重置表单</Button>
        </Space>
      </Form>

      <Divider style={{ margin: '32px 0' }} />

      {/* 修改面板密码（个人项目：无需用户名，仅密码） */}
      <div
        style={{
          marginBottom: 20,
          padding: '12px 16px',
          borderRadius: 10,
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.15)',
          color: '#9d9db3',
          fontSize: 13,
        }}
      >
        修改面板密码后，请退出并重新登录；其他浏览器若记住旧密码将无法自动登录。
      </div>
      <Form
        form={passwordForm}
        layout="vertical"
        onFinish={handleChangePassword}
        style={{ maxWidth: 640 }}
      >
        <Form.Item
          name="oldPassword"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="当前密码" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '新密码至少 6 位' },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="新密码（至少 6 位）" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || getFieldValue('newPassword') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('两次输入的密码不一致')),
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="再次输入新密码" autoComplete="new-password" />
        </Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" icon={<KeyOutlined />} loading={savingPassword}>
            修改密码
          </Button>
        </Space>
      </Form>
    </Card>
  )
}
