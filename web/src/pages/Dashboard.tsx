import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Row,
  Col,
  Card,
  Tag,
  Button,
  Space,
  App as AntdApp,
  Progress,
  Empty,
  Tooltip,
  Modal,
  Form,
  Input,
  Popconfirm,
} from 'antd'
import {
  ReloadOutlined,
  KeyOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
  SafetyCertificateOutlined,
  PlusOutlined,
  DeleteOutlined,
  SyncOutlined,
  EditOutlined,
  MailOutlined,
} from '@ant-design/icons'
import { api, type StatusResponse, type KeyUsageItem } from '../api/client'

/** 健康状态徽标 */
function HealthTag({ health }: { health: string }) {
  if (health === 'healthy') {
    return (
      <Tag color="success" icon={<CheckCircleOutlined />}>
        正常
      </Tag>
    )
  }
  return (
    <Tag color="error" icon={<SyncOutlined spin />}>
      临时禁用
    </Tag>
  )
}

/** 单张密钥额度卡片：有 token 显示实时额度，无 token 显示灰色提示并支持补填 */
function KeyCard({
  item,
  onRemove,
  onEditToken,
}: {
  item: KeyUsageItem
  onRemove: (keyId: string) => void
  onEditToken: (item: KeyUsageItem) => void
}) {
  const planPercent =
    item.planLimit !== null && item.planLimit > 0
      ? Math.min(Math.round(((item.planUsage ?? 0) / item.planLimit) * 100), 100)
      : null

  return (
    <Card className="key-card">
      <div className="key-card-header">
        <span className="key-card-keyname">{item.apiKeyMasked}</span>
        <Space size={4}>
          <HealthTag health={item.health} />
          <Tooltip title={item.hasAccountToken ? '更新 Token' : '配置 Token'}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEditToken(item)}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除该密钥？"
            description="删除后该密钥不再参与轮询"
            onConfirm={() => onRemove(item.id)}
          >
            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>

      {item.hasAccountToken ? (
        <>
          {item.email ? (
            <div
              style={{
                fontSize: 12,
                color: '#a5a5bd',
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <MailOutlined style={{ color: '#8a8aa3' }} />
              {item.email}
            </div>
          ) : null}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: '#8a8aa3' }}>
                <Tooltip title="当前计费周期已用（Tavily 官网实时数据）">
                  <SafetyCertificateOutlined style={{ marginRight: 4 }} />
                  账户已用
                </Tooltip>
              </span>
              <span style={{ fontSize: 12, color: '#c7d2fe' }}>
                {item.planUsage} / {item.planLimit} Credits
              </span>
            </div>
            {planPercent !== null && (
              <Progress
                percent={planPercent}
                size="small"
                status={planPercent >= 90 ? 'exception' : 'active'}
                strokeColor={{ from: '#a855f7', to: '#6366f1' }}
              />
            )}
          </div>
          <div className="key-card-metric">
            <span className="key-card-metric-label">账户剩余</span>
            <span className="key-card-metric-value">
              {item.keyRemaining === null ? '未知' : `${item.keyRemaining} Credits`}
            </span>
          </div>
        </>
      ) : (
        <div
          style={{
            padding: '16px 12px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.03)',
            border: '1px dashed rgba(255,255,255,0.12)',
            textAlign: 'center',
            cursor: 'pointer',
          }}
          onClick={() => onEditToken(item)}
        >
          <div style={{ fontSize: 22, color: '#4d4d63', marginBottom: 6 }}>
            <ThunderboltOutlined />
          </div>
          <div style={{ fontSize: 13, color: '#8a8aa3', marginBottom: 4 }}>
            未配置 Token
          </div>
          <div style={{ fontSize: 12, color: '#6d6d85' }}>
            配置后可查看实时额度（点击补填）
          </div>
        </div>
      )}
    </Card>
  )
}

export default function Dashboard() {
  const { message } = AntdApp.useApp()
  const [data, setData] = useState<StatusResponse | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // 添加密钥
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()
  // 编辑 Token
  const [tokenModalOpen, setTokenModalOpen] = useState(false)
  const [tokenEditing, setTokenEditing] = useState<KeyUsageItem | null>(null)
  const [tokenSubmitting, setTokenSubmitting] = useState(false)
  const [tokenForm] = Form.useForm()

  const loadStatus = async (refresh = false, silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const status = await api.status(refresh)
      setData(status)
    } catch (error) {
      if (!silent) {
        message.error(error instanceof Error ? error.message : '加载失败')
      }
    } finally {
      if (!silent) setRefreshing(false)
    }
  }

  useEffect(() => {
    // 首屏自动刷新额度，打开即有真实数据，无需手动点刷新
    void loadStatus(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await api.refreshUsage()
      message.success('额度已刷新')
      await loadStatus(false, true)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  const handleAdd = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      await api.addKey((values.apiKey as string).trim(), (values.accountToken as string)?.trim() || undefined)
      message.success('密钥已添加')
      setModalOpen(false)
      form.resetFields()
      await loadStatus(true, true)
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        return // 表单校验错误，不提示
      }
      message.error(error instanceof Error ? error.message : '添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemove = async (keyId: string) => {
    try {
      await api.removeKey(keyId)
      message.success('密钥已删除')
      await loadStatus(false, true)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  const openTokenModal = (item: KeyUsageItem) => {
    setTokenEditing(item)
    tokenForm.setFieldsValue({ accountToken: '' })
    setTokenModalOpen(true)
  }

  const handleSaveToken = async () => {
    if (!tokenEditing) return
    try {
      const values = await tokenForm.validateFields()
      setTokenSubmitting(true)
      await api.updateKeyToken(tokenEditing.id, (values.accountToken as string).trim())
      message.success('Token 已保存')
      setTokenModalOpen(false)
      await loadStatus(true, true)
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        return
      }
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setTokenSubmitting(false)
    }
  }

  const keys = data?.keys ?? []
  const accounts = data?.accounts ?? []
  const activeKeys = keys.filter((key) => key.health === 'healthy').length
  // 账户级口径：按 Tavily 账户去重后的 plan 用量合计，多 key 同账户不重复累计
  const totalPlanUsage = accounts.reduce((sum, account) => sum + account.planUsage, 0)
  const totalPlanLimit = accounts.reduce((sum, account) => sum + account.planLimit, 0)
  const planUsagePercent = totalPlanLimit > 0 ? Math.round((totalPlanUsage / totalPlanLimit) * 100) : 0

  const stats: Array<{
    label: string
    value: number | string
    icon: ReactNode
    iconClass: string
    tooltip?: string
  }> = [
    {
      label: '密钥总数',
      value: data?.keyCount ?? '-',
      icon: <KeyOutlined />,
      iconClass: 'stat-icon stat-icon-indigo',
    },
    {
      label: '健康密钥',
      value: activeKeys,
      icon: <CheckCircleOutlined />,
      iconClass: 'stat-icon stat-icon-emerald',
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div className="page-header">
        <span className="page-title">
          <DashboardOutlined />
          概览
        </span>
        <Button icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefresh}>
          刷新额度
        </Button>
      </div>

      <Row gutter={[16, 16]} align="stretch">
        {stats.map((stat) => (
          <Col xs={24} sm={12} lg={6} key={stat.label}>
            <Card className="stat-card">
              <div className={stat.iconClass}>{stat.icon}</div>
              <div>
                <div className="stat-value">{stat.value}</div>
                <div className="stat-label">
                  {stat.tooltip ? (
                    <Tooltip title={stat.tooltip}>{stat.label}</Tooltip>
                  ) : (
                    stat.label
                  )}
                </div>
              </div>
            </Card>
          </Col>
        ))}

        {/* 账户 Plan 使用进度：长进度条 + 百分比 + 总消耗/总额度 */}
        <Col xs={24} lg={12}>
          <Card className="stat-card plan-usage-card">
            <div className="plan-usage-head">
              <div className="stat-icon stat-icon-violet">
                <ThunderboltOutlined />
              </div>
              <div className="plan-usage-info">
                <div className="plan-usage-title">
                  <Tooltip title="已配置 Token 的密钥实时额度合计（Tavily 官网数据）">
                    账户 Plan 用量
                  </Tooltip>
                  <span className="plan-usage-percent">
                    {totalPlanLimit > 0 ? `${planUsagePercent}%` : '-'}
                  </span>
                </div>
                <Progress
                  percent={planUsagePercent}
                  size="small"
                  status={planUsagePercent >= 90 ? 'exception' : 'active'}
                  strokeColor={{ from: '#6366f1', to: '#a855f7' }}
                />
                <div className="plan-usage-total">
                  总消耗 <b>{totalPlanUsage}</b> / {totalPlanLimit} Credits
                </div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      <Card
        className="glass-card"
        title={
          <span>
            <SafetyCertificateOutlined style={{ marginRight: 8 }} />
            密钥额度概览
          </span>
        }
        extra={
          <Button
            className="key-add-btn"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setModalOpen(true)}
          >
            添加密钥
          </Button>
        }
      >
        {keys.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="密钥池为空，点击右上角「添加密钥」"
          />
        ) : (
          <Row gutter={[16, 16]}>
            {keys.map((key) => (
              <Col xs={24} md={12} xl={8} key={key.id}>
                <KeyCard
                  item={key}
                  onRemove={(keyId) => void handleRemove(keyId)}
                  onEditToken={(item) => openTokenModal(item)}
                />
              </Col>
            ))}
          </Row>
        )}
      </Card>

      {/* 添加密钥 */}
      <Modal
        title="添加 Tavily API Key"
        open={modalOpen}
        onOk={handleAdd}
        confirmLoading={submitting}
        onCancel={() => setModalOpen(false)}
        okText="添加"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="apiKey"
            label="API Key"
            rules={[
              { required: true, message: '请输入 API Key' },
              { pattern: /^tvly-/, message: 'Key 应以 tvly- 开头' },
            ]}
          >
            <Input.Password placeholder="tvly-xxx" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="accountToken"
            label="Token（可选）"
            extra="从 app.tavily.com 的 Cookie（appSession）获取，用于实时查询额度；不填则密钥正常参与轮询但不展示额度。"
          >
            <Input.Password placeholder="eyJhbGci..." autoComplete="off" />
          </Form.Item>
          <div style={{ fontSize: 12, color: '#8a8aa3' }}>
            添加后密钥立即进入轮询池；配置 Token 后额度自动刷新。
          </div>
        </Form>
      </Modal>

      {/* 编辑/补填 Token */}
      <Modal
        title={`${tokenEditing?.hasAccountToken ? '更新' : '配置'} Token — ${tokenEditing?.apiKeyMasked ?? ''}`}
        open={tokenModalOpen}
        onOk={handleSaveToken}
        confirmLoading={tokenSubmitting}
        onCancel={() => setTokenModalOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={tokenForm} layout="vertical">
          <Form.Item
            name="accountToken"
            label="Token（appSession）"
            rules={[{ required: true, message: '请输入 Token' }]}
            extra="从 app.tavily.com 的 Cookie（appSession）获取；保存后立即查询实时额度。"
          >
            <Input.Password placeholder="eyJhbGci..." autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
