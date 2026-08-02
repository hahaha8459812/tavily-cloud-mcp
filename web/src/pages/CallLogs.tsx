import { useEffect, useState } from 'react'
import {
  Card,
  Table,
  Tag,
  InputNumber,
  Button,
  Space,
  Empty,
  Tooltip,
  App as AntdApp,
} from 'antd'
import {
  HistoryOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons'
import { api, type CallLogEntry } from '../api/client'

/** 时间戳格式化为本地时间（秒级精度） */
function formatTime(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 调用记录页：展示内存缓冲中的 MCP 调用记录，可设置保存条数上限（重启清空，不持久化） */
export default function CallLogs() {
  const { message } = AntdApp.useApp()
  const [entries, setEntries] = useState<CallLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingMax, setEditingMax] = useState<number | null>(200)

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.getCallLogs()
      setEntries(data.entries)
      setEditingMax(data.maxEntries)
    } catch (error) {
      if (!silent) {
        message.error(error instanceof Error ? error.message : '加载失败')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRefresh = async () => {
    await load(true)
    message.success('已刷新')
  }

  const handleSaveMax = async () => {
    if (editingMax === null || !Number.isInteger(editingMax)) return
    setSaving(true)
    try {
      const { maxEntries: savedMax } = await api.setCallLogMaxEntries(editingMax)
      setEditingMax(savedMax)
      message.success(`保存条数上限已更新为 ${savedMax}（已持久化，重启后保留）`)
      await load(true)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: '时间',
      dataIndex: 'at',
      width: 160,
      render: (at: number) => formatTime(at),
    },
    {
      title: '工具',
      dataIndex: 'tool',
      width: 140,
      render: (tool: string) => <span style={{ fontFamily: 'Consolas, monospace', color: '#c7d2fe' }}>{tool}</span>,
    },
    {
      title: '密钥',
      dataIndex: 'keyMasked',
      width: 160,
      render: (key: string) => <span style={{ fontFamily: 'Consolas, monospace', color: '#a5a5bd' }}>{key}</span>,
    },
    {
      title: '耗时',
      dataIndex: 'costMs',
      width: 100,
      render: (costMs: number) => `${costMs} ms`,
    },
    {
      title: '消耗',
      dataIndex: 'credits',
      width: 100,
      render: (credits: number | null) => (credits === null ? <span style={{ color: '#6d6d85' }}>未知</span> : `${credits} credits`),
    },
    {
      title: '状态',
      dataIndex: 'success',
      width: 90,
      render: (success: boolean, record: CallLogEntry) =>
        success ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            成功
          </Tag>
        ) : (
          <Tooltip title={record.error ?? '失败'}>
            <Tag color="error" icon={<CloseCircleOutlined />}>
              失败
            </Tag>
          </Tooltip>
        ),
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div className="page-header">
        <span className="page-title">
          <HistoryOutlined />
          调用记录
        </span>
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={handleRefresh}>
            刷新
          </Button>
        </Space>
      </div>

      <Card
        className="glass-card"
        title={
          <span>
            <HistoryOutlined style={{ marginRight: 8 }} />
            MCP 调用记录
            <span style={{ marginLeft: 12, fontSize: 12, color: '#8a8aa3', fontWeight: 400 }}>
              共 {entries.length} 条（内存缓冲，重启清空）
            </span>
          </span>
        }
        extra={
          <Space>
            <span style={{ color: '#8a8aa3', fontSize: 13 }}>保存条数上限</span>
            <InputNumber
              min={10}
              max={1000}
              value={editingMax}
              onChange={(value) => setEditingMax(value ?? null)}
              style={{ width: 100 }}
            />
            <Button type="primary" size="small" loading={saving} onClick={handleSaveMax}>
              保存
            </Button>
          </Space>
        }
      >
        {entries.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无调用记录，执行 MCP 工具调用后此处会展示"
          />
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={entries}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
            size="small"
            scroll={{ x: 750 }}
          />
        )}
      </Card>
    </Space>
  )
}
