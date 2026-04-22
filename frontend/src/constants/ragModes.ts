/**
 * RAG mode descriptions, used in both the chat picker tooltip and the
 * Knowledge → "模式对比" panel.
 */
import type { RAGMode } from '../api/client'

export interface RAGModeMeta {
  key: RAGMode
  label: string
  short: string
  description: string
  bestFor: string
  cost: 'low' | 'medium' | 'high'
}

export const RAG_MODES: RAGModeMeta[] = [
  {
    key: 'naive',
    label: 'Naive（朴素）',
    short: '纯向量召回',
    description:
      '直接用向量相似度召回 Top-K 文本块，不走任何图谱推理。等同于传统 RAG。',
    bestFor: '事实性问答、关键词明确、对延迟敏感。',
    cost: 'low',
  },
  {
    key: 'local',
    label: 'Local（局部）',
    short: '实体邻域',
    description:
      '先匹配查询中的实体，再沿知识图谱拉取该实体的一阶/二阶邻居及其相关文本块。',
    bestFor: '"X 是什么 / X 有哪些属性"等围绕单个实体的细节追问。',
    cost: 'medium',
  },
  {
    key: 'global',
    label: 'Global（全局）',
    short: '主题/社区',
    description:
      '基于图谱社区检测得到的主题摘要回答，跳过具体文本块，关注全局趋势与归纳。',
    bestFor: '"总体来看…"、"主要分为哪几类…"这类抽象 / 概括性问题。',
    cost: 'high',
  },
  {
    key: 'hybrid',
    label: 'Hybrid（混合，默认）',
    short: 'Local + Global',
    description:
      '同时执行 local 与 global 两条路径并融合证据，鲁棒性最好。',
    bestFor: '不确定要哪种模式时的安全默认值。',
    cost: 'high',
  },
]

export const RAG_MODE_MAP: Record<RAGMode, RAGModeMeta> =
  Object.fromEntries(RAG_MODES.map((m) => [m.key, m])) as Record<RAGMode, RAGModeMeta>
