import { chatComplete } from '@/lib/llm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/ai-experiment - AI-powered experiment design advisor
// Suggests baselines, ablation components, metrics, and hyperparameters
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { topic, method, type } = body // type: 'design' | 'baselines' | 'ablation' | 'checklist'

    if (!topic && !method) {
      return NextResponse.json({ error: 'Missing topic or method' }, { status: 400 })
    }

    // Gather existing experiments for context
    const experiments = await db.experiment.findMany({ take: 5, orderBy: [{ createdAt: 'desc' }] })
    const expContext = experiments.map((e) => ({
      name: e.name,
      status: e.status,
      config: e.config,
      baselines: e.baselines,
    }))

    const context = `
研究课题: ${topic || '未指定'}
使用方法: ${method || '未指定'}
已有实验:
${JSON.stringify(expContext, null, 2)}
`.trim()

    let systemPrompt = ''
    let userPrompt = ''

    switch (type) {
      case 'design':
        systemPrompt = '你是一位通信 AI 实验设计专家，擅长设计完整的实验方案。请用中文回答，结构化输出。'
        userPrompt = `基于以下信息，设计一个完整的实验方案。

${context}

请按以下格式输出：

## 实验设计方案

### 1. 实验目标
- 主要目标: ...
- 次要目标: ...

### 2. 系统模型
- 场景描述: ...
- 关键假设: ...
- 评估指标: ...

### 3. 基线方法（至少 3 个）
| 方法 | 类型 | 描述 | 预期性能 |
|------|------|------|---------|
| ... | 传统 | ... | ... |
| ... | AI | ... | ... |
| ... | SOTA | ... | ... |

### 4. 消融实验设计
- 组件 1: ...
- 组件 2: ...
- 组件 3: ...

### 5. 超参数建议
- learning_rate: ...
- batch_size: ...
- hidden_dim: ...
- 其他: ...

### 6. 实验步骤
1. ...
2. ...
3. ...

### 7. 预期结果
- 主要指标提升: ...
- 收敛速度: ...
- 计算复杂度: ...`
        break
      case 'baselines':
        systemPrompt = '你是一位通信领域的基线方法专家。请用中文回答，结构化输出。'
        userPrompt = `基于以下信息，推荐 3-5 个应该对比的基线方法。

${context}

请按以下格式输出：

## 基线方法推荐

### 基线 1: [名称]
- **类型**: 传统方法 / 简单AI / SOTA
- **原理**: ...
- **优势**: ...
- **劣势**: ...
- **复现难度**: 高/中/低
- **开源代码**: 有/无 (GitHub链接如有)

### 基线 2: [名称]
...`
        break
      case 'ablation':
        systemPrompt = '你是一位消融实验设计专家。请用中文回答，结构化输出。'
        userPrompt = `基于以下信息，设计消融实验方案。

${context}

请按以下格式输出：

## 消融实验设计

### 消融组件 1: [名称]
- **在方法中的作用**: ...
- **移除后的预期影响**: ...
- **验证方式**: ...

### 消融组件 2: [名称]
...

### 消融实验表
| 方法变体 | 移除组件 | 预期性能 | 下降幅度 |
|---------|---------|---------|---------|
| Full method | - | ... | - |
| w/o 组件1 | 组件1 | ... | ...% |
| w/o 组件2 | 组件2 | ... | ...% |

### 结论模板
"其中[组件X]对性能贡献最大，去除后性能下降YY%，说明该组件是方法的核心创新所在"`
        break
      case 'checklist':
        systemPrompt = '你是一位实验完整性检查专家。请用中文回答，结构化输出。'
        userPrompt = `基于以下信息，生成实验完整性检查清单。

${context}

请按以下格式输出：

## 实验完整性检查清单

### ✅ 基线对比
- [ ] 传统方法已对比
- [ ] 简单 AI 基线已对比
- [ ] SOTA 方法已对比

### ✅ 消融实验
- [ ] 至少 2 个消融组件
- [ ] 每个组件的贡献已量化
- [ ] 核心创新点已验证

### ✅ 统计显著性
- [ ] 多次随机种子实验 (≥5次)
- [ ] 误差棒/标准差已标注
- [ ] p-value 已计算

### ✅ 可视化
- [ ] 收敛曲线
- [ ] 性能对比柱状图
- [ ] 参数敏感性分析

### ✅ 可复现性
- [ ] 固定随机种子
- [ ] 超参数已记录
- [ ] 代码可开源

### ⚠️ 常见问题
1. ...
2. ...
3. ...`
        break
      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const content = await chatComplete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { timeoutMs: 180_000 }
    )

    return NextResponse.json({ success: true, content, type })
  } catch (e) {
    console.error('AI experiment error', e)
    return NextResponse.json({ error: 'AI failed: ' + (e as Error).message }, { status: 500 })
  }
}
