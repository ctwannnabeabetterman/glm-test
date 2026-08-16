import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { GANTT_TEMPLATE } from '@/lib/methodology-data'

// POST /api/seed - seed demo data for first-time use
export async function POST() {
  try {
    const results: Record<string, number> = {}

    // 1. Seed baseline papers if empty
    const paperCount = await db.paper.count()
    if (paperCount === 0) {
      const papers = [
        { title: 'Deep Reinforcement Learning for Resource Allocation in Wireless Networks', authors: 'Nasir, Y. S., Guo, D.', venue: 'IEEE TCOM, 2019', year: 2019, citations: 500, relevance: 9, novelty: 7, priority: 'high', status: 'read', codeUrl: 'github.com/example/drl-resource-allocation', tags: 'DRL,资源分配', category: 'baseline', notes: 'DRL资源分配的经典综述+方案，从这篇开始' },
        { title: 'LSTM-Based Channel Estimation for Massive MIMO Systems', authors: 'Wu, J. et al.', venue: 'IEEE CL, 2020', year: 2020, citations: 150, relevance: 8, novelty: 5, priority: 'high', status: 'unread', codeUrl: '', tags: 'LSTM,信道估计', category: 'baseline', notes: '与课程内容直接相关，作为基线方法' },
        { title: 'Multi-Agent Reinforcement Learning for Spectrum Sharing', authors: 'Sharma, P. et al.', venue: 'IEEE ICC, 2021', year: 2021, citations: 80, relevance: 7, novelty: 8, priority: 'medium', status: 'reading', codeUrl: '', tags: 'MARL,频谱共享', category: 'method', notes: 'MADDPG在多用户频谱共享中的应用' },
        { title: 'Transformer for Wireless Channel Prediction', authors: 'Liu, X. et al.', venue: 'IEEE TWC, 2023', year: 2023, citations: 65, relevance: 6, novelty: 9, priority: 'medium', status: 'unread', codeUrl: '', tags: 'Transformer,信道预测', category: 'method', notes: 'Transformer在时变信道预测中的应用' },
        { title: 'Federated Learning in Wireless Networks', authors: 'Chen, M. et al.', venue: 'IEEE TCOM, 2022', year: 2022, citations: 220, relevance: 5, novelty: 7, priority: 'low', status: 'unread', codeUrl: 'github.com/example/fl-wireless', tags: '联邦学习', category: 'survey', notes: '联邦学习综述，可作为扩展阅读' },
        { title: 'A Survey on Deep Reinforcement Learning for 5G and Beyond', authors: 'Zhang, S. et al.', venue: 'IEEE COMST, 2023', year: 2023, citations: 380, relevance: 8, novelty: 6, priority: 'high', status: 'read', codeUrl: '', tags: 'DRL,综述', category: 'survey', notes: 'DRL在5G中的应用综述，必读' },
        { title: 'GNN-based Distributed Power Control', authors: 'Ye, H. et al.', venue: 'IEEE TWC, 2022', year: 2022, citations: 95, relevance: 7, novelty: 8, priority: 'medium', status: 'unread', codeUrl: 'github.com/example/gnn-power', tags: 'GNN,功率控制', category: 'method', notes: 'GNN做分布式功率控制，可借鉴' },
        { title: 'RIS-assisted mmWave Communication: A Deep Learning Approach', authors: 'Huang, T. et al.', venue: 'IEEE ICC, 2023', year: 2023, citations: 40, relevance: 8, novelty: 9, priority: 'high', status: 'reading', codeUrl: '', tags: 'RIS,mmWave,DL', category: 'method', notes: 'RIS辅助毫米波，方法新，可对比' },
      ]
      for (const p of papers) {
        await db.paper.create({ data: p })
      }
      results.papers = papers.length
    }

    // 2. Seed topics if empty
    const topicCount = await db.topic.count()
    if (topicCount === 0) {
      const topics = [
        {
          name: '基于DRL的RIS辅助无线资源分配',
          direction: 'MAC层',
          description: '研究RIS辅助下多用户干扰信道的资源分配，使用DRL方法',
          scores: JSON.stringify({
            '创新性': { '问题新颖度': 8, '方法创新性': 7, '与现有工作的区分度': 8 },
            '可行性': { '数据/仿真平台可得性': 7, '基线可复现程度': 8, '计算资源需求': 7, '个人能力匹配度': 7 },
            '发表价值': { '目标会议/期刊匹配度': 8, '预期贡献的显著性': 7, '竞争激烈程度': 6 },
            '可持续性': { '能否扩展为多篇论文': 8, '是否与毕业论文方向一致': 9, '后续研究空间': 8 },
          }),
          totalScore: 7.62,
        },
        {
          name: '基于LSTM的毫米波信道预测',
          direction: '物理层',
          description: 'LSTM用于毫米波时变信道预测，提升估计精度',
          scores: JSON.stringify({
            '创新性': { '问题新颖度': 6, '方法创新性': 5, '与现有工作的区分度': 6 },
            '可行性': { '数据/仿真平台可得性': 9, '基线可复现程度': 9, '计算资源需求': 9, '个人能力匹配度': 8 },
            '发表价值': { '目标会议/期刊匹配度': 7, '预期贡献的显著性': 6, '竞争激烈程度': 7 },
            '可持续性': { '能否扩展为多篇论文': 6, '是否与毕业论文方向一致': 7, '后续研究空间': 6 },
          }),
          totalScore: 6.92,
        },
      ]
      for (const t of topics) {
        await db.topic.create({ data: t })
      }
      results.topics = topics.length
    }

    // 3. Seed experiments if empty
    const expCount = await db.experiment.count()
    if (expCount === 0) {
      const experiments = [
        { name: 'DQN Power Control - Baseline Run', topic: '基于DRL的RIS辅助无线资源分配', status: 'completed', config: JSON.stringify({ model: 'DQN', lr: 0.001, batch_size: 64, hidden_dim: 128, gamma: 0.99, epsilon_start: 1.0, epsilon_end: 0.01, n_users: 4, snr_db: 10 }), metrics: JSON.stringify({ avg_throughput: 45.6, avg_delay: 2.3, convergence_epoch: 67, baseline_wmmse: 32.1 }), baselines: JSON.stringify(['WMMSE', 'FP-LSTM', 'DQN baseline']), ablations: JSON.stringify(['multi-agent', 'attention mechanism', 'experience replay size']), notes: '低SNR下性能不稳定，需要调整奖励函数' },
        { name: 'PPO Power Control - Comparison', topic: '基于DRL的RIS辅助无线资源分配', status: 'running', config: JSON.stringify({ model: 'PPO', lr: 0.0003, batch_size: 256, hidden_dim: 128, gamma: 0.99, clip_range: 0.2, n_users: 4, snr_db: 10 }), metrics: JSON.stringify({}), baselines: JSON.stringify(['WMMSE', 'DQN']), ablations: JSON.stringify([]), notes: '正在尝试PPO替代DQN' },
        { name: 'LSTM Channel Estimation - Massive MIMO', topic: '基于LSTM的毫米波信道预测', status: 'planned', config: JSON.stringify({ model: 'BiLSTM', hidden_dim: 64, num_layers: 2, dropout: 0.1, lr: 0.001, n_ant: 4, n_sub: 16 }), metrics: JSON.stringify({}), baselines: JSON.stringify(['MMSE', 'LS']), ablations: JSON.stringify([]), notes: '准备开始基线复现' },
      ]
      for (const e of experiments) {
        await db.experiment.create({ data: e })
      }
      results.experiments = experiments.length
    }

    // 4. Seed gantt milestones if empty
    const ganttCount = await db.milestone.count({ where: { type: 'gantt' } })
    if (ganttCount === 0) {
      for (const t of GANTT_TEMPLATE) {
        await db.milestone.create({
          data: {
            type: 'gantt',
            title: t.name,
            startDate: String(t.start),
            endDate: String(t.end),
            duration: t.end - t.start,
            progress: t.start < 14 ? 100 : t.start < 24 ? 60 : t.start < 32 ? 20 : 0,
            category: t.category,
            color: t.color,
          },
        })
      }
      results.gantt = GANTT_TEMPLATE.length
    }

    // 5. Seed writing milestones
    const writingCount = await db.milestone.count({ where: { type: 'writing' } })
    if (writingCount === 0) {
      const today = new Date()
      const submissionDate = new Date(today.getFullYear(), today.getMonth() + 3, 15) // 3 months from now
      const writingItems = [
        { name: '实验数据完整', days: 42, color: '#10b981' },
        { name: 'Method + Experiments 初稿', days: 35, color: '#06b6d4' },
        { name: 'Introduction + Related Work', days: 28, color: '#3b82f6' },
        { name: '全篇初稿完成', days: 21, color: '#8b5cf6' },
        { name: '内部评审与修改', days: 14, color: '#ec4899' },
        { name: '英文语言润色', days: 7, color: '#f59e0b' },
        { name: '格式检查与提交', days: 2, color: '#ef4444' },
      ]
      for (const w of writingItems) {
        const deadline = new Date(submissionDate)
        deadline.setDate(deadline.getDate() - w.days)
        await db.milestone.create({
          data: {
            type: 'writing',
            title: w.name,
            startDate: deadline.toISOString().slice(0, 10),
            endDate: deadline.toISOString().slice(0, 10),
            duration: w.days,
            progress: 0,
            category: 'writing',
            color: w.color,
            targetVenue: 'IEEE ICC',
          },
        })
      }
      results.writing = writingItems.length
    }

    // 6. Seed a sample note
    const noteCount = await db.note.count()
    if (noteCount === 0) {
      await db.note.create({
        data: {
          title: 'DRL资源分配 - 核心方法笔记',
          category: 'literature',
          tags: 'DRL,资源分配,基线',
          content: `# DRL资源分配 - 核心方法笔记

## 元数据
- **作者**: Nasir, Y. S., Guo, D.
- **年份**: 2019
- **期刊**: IEEE TCOM

## 一句话概括
将多用户无线资源分配建模为MDP，使用DQN进行分布式功率控制。

## 核心方法
- **状态**: 各用户信道增益 + 干扰测量
- **动作**: 每个用户的发射功率（离散化）
- **奖励**: -∑(干扰功率) + λ·log(吞吐量)

## 关键公式
SINR_k = (P_k * h_kk) / (Σ_{j≠k} P_j * h_kj + σ²)

## 实验结果
- 数据集: 自建仿真（Rayleigh fading）
- 基线对比: WMMSE +12%, FP +8%
- 收敛 epoch: ~67

## 与我的课题关联
- 可借鉴: DQN 状态/动作空间设计
- 可改进: 添加 attention 机制，应对多用户协作

## 待解决
- ❓ 为什么这个方法在低SNR下失效？
- 💡 可以考虑叠加 attention 机制`,
        },
      })
      results.notes = 1
    }

    return NextResponse.json({ success: true, results })
  } catch (e) {
    console.error('Seed error', e)
    return NextResponse.json({ error: 'Seed failed' }, { status: 500 })
  }
}
