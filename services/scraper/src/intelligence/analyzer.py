"""AI-powered Tender Intelligence Report generator (v5 — deep Markdown).

Budget: max $5 per analysis. Uses gpt-4o (best quality/cost ratio) with
16K output tokens for comprehensive 5000-8000 character Chinese reports.

Two modes:
  1. Full analysis (gpt-4o, 16K tokens): employee uploads bid documents,
     AI produces a deep, citation-rich Markdown report. ~$0.20-$0.50/run.
  2. Mini summary (gpt-4o-mini): lightweight 2-3 sentence assessment,
     essentially free (~$0.001/run).
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import json
import openai
import re
import yaml

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "config" / "prompts"

# Per-analysis budget cap (USD)
MAX_COST_PER_ANALYSIS = 5.0

# ──────────────────────────────────────────────────────────────
# System prompt — role & business context (shared)
# ──────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
你是一位资深的政府采购情报分析师和投标策略顾问，拥有15年以上北美政府/机构采购合同的深度分析经验。

你的客户是一家北美窗饰遮阳产品制造安装公司（Sunny Shutter），具体业务包括：
- 供应与安装：百叶窗、卷帘、斑马帘、电动遮阳帘、太阳能遮阳帘、遮光帘、天窗遮阳系统
- 供应与安装：窗帘、窗幔、隐私帘、医院隔帘、办公隔断帘
- FF&E（家具、固定装置与设备）整体供应与安装
- 从中国制造商采购产品，在北美完成供应/安装项目
- 主要服务商业项目：医院、学校、酒店、政府大楼、多户住宅
- 年营业额：中等规模，有稳定的美国和加拿大政府合同经验

核心规则：
- 所有输出必须使用简体中文
- 绝不编造事实。如果招标文件中没有相关信息，明确说明"招标文件未说明"
- 直接、具体、可操作。每一句话都要帮助读者做出投标/不投标的决定
- 当有文档原文时，深入挖掘具体规格、数量、条款编号，**逐字引用英文原文并附中文翻译**
- 以"如果你是这家公司的老板"的视角给出投标策略建议
- 必须给出量化评估和明确的 GO/NO-GO 结论
- 报告目标长度：5000-8000字中文，确保深度和可操作性"""

# ──────────────────────────────────────────────────────────────
# Full analysis prompt — deep Markdown report
# ──────────────────────────────────────────────────────────────

_FULL_ANALYSIS_PROMPT = """\
你现在正在为 Sunny Shutter 投标团队撰写一份正式的《招标情报分析报告》。
这份报告将直接决定公司是否投入人力和资金准备标书，必须做到**深入、具体、有引用依据**。

## 招标基本信息

| 字段 | 内容 |
|------|------|
| 标题 | {title} |
| 采购机构 | {organization} |
| 招标编号 | {solicitation_number} |
| 地点 | {location} |
| 国家 | {country} |
| 截标日期 | {closing_date} |
| 来源平台 | {source} |

## 招标描述/范围

{description}

## 招标文件原文

{document_text}

---

# 报告撰写要求

请按以下完整大纲撰写报告。**每一节至少 300-500 字**，必须包含具体的条款引用、数据分析和可操作建议。
不要跳过任何章节，不要写空泛的套话。

---

# 招标情报分析报告

## 一、一句话结论

用一句话（50字以内）给出明确建议：**建议投标** / **谨慎评估** / **不建议投标**。
紧接着用2-3句话说明核心理由。

## 二、项目概述与采购背景

深入分析：
- 采购机构的性质（联邦/州/市/学区/医疗系统等）、规模和历史采购习惯
- 项目类型判断：一次性采购 / 框架协议(Standing Agreement) / 年度合同 / BPA
- 项目总价值区间估算（基于数量、规格和行业经验）
- 此次采购的业务背景和目的（新建/翻新/替换/扩建）
- 该采购机构是否有往期类似采购记录

## 三、需求范围逐项深度分析

**必须逐项列出每一个交付物**，不能笼统概括：
- 产品名称、具体数量、尺寸规格、材质要求
- 引用文档原文（如 "Section C.3.1 requires..." 原文 + 中文翻译）
- 供货 vs 供货+安装 vs 全包服务的范围界定
- 是否包含拆旧、废料处理、现场测量
- 分批交付要求（各批次数量和时间）
- 质保条款（年限、范围、响应时间、备件供应）
- 培训要求（使用培训、维护培训）

## 四、技术要求逐条评估

对每条技术要求进行**逐条评估**，使用以下格式：

| 要求项 | 原文引用 | 我司满足情况 | 需要准备 |
|--------|---------|-------------|---------|
| 材质规格 | "..." | ✅通过/⚠️需确认/❌不满足 | ... |

必须覆盖：
- 产品材质、规格、颜色、性能参数
- 认证要求（NFPA 701、ASTM、CSA、UL 等，引用具体标准编号和条款）
- 防火等级要求
- 环保/VOC/可回收要求
- 电动化/自动化需求（电机规格、控制系统、协议兼容性）
- 样品提交要求（数量、时间、评审标准）
- 包装/标签/交付要求

## 五、时间线与关键日期全景分析

绘制完整时间表：

| 事件 | 日期 | 距今天数 | 备注 |
|------|------|---------|------|
| 投标截止 | ... | ... | ... |
| Q&A截止 | ... | ... | ... |

分析：
- 从中国采购+海运+清关的全流程时间（通常60-90天，按产品类别细分）
- 时间线是否可行？标记红色风险节点
- 建议的内部准备倒排时间表
- 紧急情况的空运备选方案及成本影响

## 六、评标标准与得分最大化策略

- 逐项列出评标标准及权重（如有）
- 如文件未明确说明权重，基于采购机构类型推测评标重点
- **针对每个评分维度，给出3条具体的得分最大化行动**
- 报价策略建议：目标价格区间、定价方法论（成本+利润 vs 竞争定价）
- LPTA vs Best Value 评标方式判断

## 七、我司匹配度详细评估

逐维度打分（1-5分）并说明理由：

| 评估维度 | 得分(1-5) | 详细说明 |
|---------|----------|---------|
| 产品匹配度 | ? | 品类覆盖率、规格满足度、品牌要求 |
| 安装能力 | ? | 本地团队、设备、许可证 |
| 项目经验 | ? | 同类型/同规模/同行业的过往案例 |
| 资质合规 | ? | 营业执照、保险、债券、安全认证 |
| 财务能力 | ? | 保证金、信用担保、营业额门槛 |
| 供应链可靠性 | ? | 交期保障、库存策略、应急预案 |

**综合匹配度得分** 及差距分析。

## 八、合规风险与致命红线

⚠️ **每一条致命风险都必须用 ⚠️ 标记并加粗**。

逐项分析（**必须引用原文条款**）：
- ⚠️ 可能直接导致废标的强制性要求
- 投标保证金/履约保函（金额、形式、有效期）
- 保险要求（类型、最低保额、额外被保险人要求）
- 小企业/少数族裔/退伍军人优先条款
- 过往业绩门槛（最低合同金额、项目数量、年限要求）
- Set-Aside / Sole Source 限制
- 对每个风险项给出**具体的应对策略或替代方案**

## 九、供应链与中国采购深度可行性分析

- Buy America (41 USC §8302) / Buy Canadian / Trade Agreement 的具体条款逐一分析
- 是否有豁免条款（如 FAR 25.103 例外情形）或变通方案
- 海运周期 vs 项目交付时间的可行性计算
- 关税税率（HTS 编码分析）和进口成本对报价的百分比影响
- 建议的最优供应链方案（直接从中国 / 北美仓库 / 本地代理 / 混合模式）
- 汇率风险评估

## 十、竞争格局与差异化策略

- 该品类的主要竞争对手（列出2-3家可能参与的公司）
- 我司 vs 竞争对手的优势/劣势对比
- 推荐参与方式：主承包 / 分包 / 联合体（含理由）
- 3条具体的差异化卖点提炼
- 投标文件中应重点展示的案例和能力

## 十一、GO/NO-GO 决策矩阵

| 评估维度 | 权重 | 评分(1-5) | 加权分 | 关键说明 |
|---------|------|----------|-------|---------|
| 产品匹配度 | 25% | ? | ? | ... |
| 技术满足度 | 20% | ? | ? | ... |
| 时间可行性 | 15% | ? | ? | ... |
| 价格竞争力 | 15% | ? | ? | ... |
| 合规风险 | 15% | ? | ? | ... |
| 中标概率 | 10% | ? | ? | ... |
| **综合加权总分** | 100% | — | **?/5.0** | |

- **3.5分以上**：建议投标
- **2.5-3.5分**：谨慎评估，需补充条件
- **2.5分以下**：不建议投标

最终决策建议及理由。定价策略（目标利润率范围）。

## 十二、投标团队行动清单

| # | 待办事项 | 负责人建议 | 截止日期 | 优先级 | 预计工时 |
|---|---------|----------|---------|-------|---------|
| 1 | ... | ... | ... | 🔴高 | ... |
| 2 | ... | ... | ... | 🟡中 | ... |

列出投标前必须完成的**所有**具体事项，按优先级排序，包含时间节点。

---

# 分析深度硬性要求（必须全部遵守）

1. **条款引用**：对关键条款，逐字引用英文原文，格式为 `> "Section X.X: [英文原文]"` 后附中文翻译
2. **量化数据**：涉及金额、数量、规格时必须给出具体数字，禁止"若干""一些""大量"等模糊词
3. **每个结论有依据**：要么来自文档引用，要么基于明确的行业经验推理（标注"基于行业经验"）
4. **致命风险穷尽**：不遗漏任何可能导致废标的条款
5. **GO/NO-GO 必须量化**：填写完整的决策矩阵，给出加权总分
6. **信息不足标注**：如某方面信息不足，写"⚪ 招标文件未说明——建议通过 Q&A 确认"
7. **报告目标长度：5000-8000字**——这是一份正式的投标决策文件，不是摘要"""

# ──────────────────────────────────────────────────────────────
# Mini summary prompt — lightweight assessment
# ──────────────────────────────────────────────────────────────

_MINI_SUMMARY_PROMPT = """\
根据以下招标信息，用2-3句话给出简要的初步评估。

标题: {title}
采购机构: {organization}
地点: {location}
截标日期: {closing_date}
描述: {description}

请从以下角度简要评估（2-3句话，总共不超过150字）：
1. 这个项目与我们窗饰遮阳公司的业务匹配度如何？
2. 有什么需要特别注意的要点？
3. 是否值得进一步查看招标文件？

直接输出评估内容，不要标题或格式标记。"""


def _load_prompt_template(template_key: str, fallback_system: str, fallback_user: str) -> tuple[str, str]:
    """Load prompt template from YAML, fallback to built-in strings."""
    try:
        # Prevent path traversal; template key is logical identifier only.
        if not re.match(r"^[A-Za-z0-9_.-]+$", template_key or ""):
            logger.warning("Invalid prompt template key: %s", template_key)
            return fallback_system, fallback_user
        prompt_path = _PROMPTS_DIR / f"{template_key}.yaml"
        if not prompt_path.exists():
            return fallback_system, fallback_user
        with prompt_path.open("r", encoding="utf-8") as f:
            payload = yaml.safe_load(f) or {}
        system_prompt = str(payload.get("system_prompt") or fallback_system)
        user_prompt = str(payload.get("user_prompt") or fallback_user)
        return system_prompt, user_prompt
    except Exception as exc:
        logger.warning("Failed to load prompt template '%s': %s", template_key, exc)
        return fallback_system, fallback_user


def _structured_report_to_markdown(payload: dict[str, Any]) -> str:
    """Render structured Bid/No-Bid output to markdown for backward compatibility."""
    fit_score = payload.get("fit_score")
    recommendation = payload.get("recommendation")
    confidence = payload.get("confidence")
    lines = [
        "## Bid/No-Bid 分析报告",
        "",
        f"- 匹配分数: {fit_score if fit_score is not None else '未提供'}",
        f"- 推荐结论: {recommendation or '未提供'}",
        f"- 置信度: {confidence or '未提供'}",
        "",
        "### 主要原因",
    ]
    for item in payload.get("main_reasons", []) or ["无"]:
        lines.append(f"- {item}")
    lines.extend(["", "### 风险点"])
    for item in payload.get("risks", []) or ["无"]:
        lines.append(f"- {item}")
    lines.extend(["", "### 缺失信息"])
    for item in payload.get("missing_information", []) or ["无"]:
        lines.append(f"- {item}")
    lines.extend(["", "### 需要人工确认"])
    for item in payload.get("human_confirmations", []) or ["无"]:
        lines.append(f"- {item}")
    lines.extend(["", "### 推荐下一步"])
    for item in payload.get("recommended_next_steps", []) or ["无"]:
        lines.append(f"- {item}")
    return "\n".join(lines)

# ──────────────────────────────────────────────────────────────
# Cost estimation
# ──────────────────────────────────────────────────────────────

_COST_PER_1M: dict[str, tuple[float, float]] = {
    # (input $/1M, output $/1M)
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
}


def estimate_analysis_cost(
    input_chars: int,
    output_tokens: int = 16000,
    model: str = "gpt-4o",
) -> float:
    """Estimate cost in USD. ~4 chars ≈ 1 token for mixed CJK+English."""
    input_tokens = input_chars // 3  # conservative for CJK
    rates = _COST_PER_1M.get(model, (2.50, 10.00))
    cost = (input_tokens / 1_000_000) * rates[0] + (output_tokens / 1_000_000) * rates[1]
    return round(cost, 4)


class TenderAnalyzer:
    """Generates Tender Intelligence Reports using OpenAI.

    Default: gpt-4o with 16K output tokens.
    Typical cost: $0.20-$0.50 per analysis (well within $5 budget).
    """

    def __init__(self, model: str = "gpt-4o", max_tokens: int = 16000) -> None:
        self._model = model if model in ("gpt-4o", "gpt-4o-mini") else "gpt-4o"
        self._max_tokens = max_tokens

    def analyze(
        self,
        title: str,
        organization: str | None = None,
        location: str | None = None,
        closing_date: str | None = None,
        source: str = "Unknown",
        description: str | None = None,
        document_texts: dict[str, str] | None = None,
        *,
        solicitation_number: str | None = None,
        country: str | None = None,
        prompt_template_key: str | None = None,
    ) -> dict[str, Any]:
        """Run full AI analysis and return a Markdown report.

        Returns {"report_markdown": str, "model": str, "analyzed_at": str,
                 "prompt_tokens": int, "completion_tokens": int,
                 "estimated_cost_usd": float, "fallback": bool}
        """
        if not settings.OPENAI_API_KEY:
            logger.error("OPENAI_API_KEY not configured")
            return self._fallback(title, description)

        desc_text = (description or "")[:20000]
        doc_text = self._prepare_documents(document_texts, max_total=100000)

        if not desc_text and not doc_text:
            logger.warning("No content to analyze for: %s", title)
            return self._fallback(title, description)

        template_key = prompt_template_key or "default.deep"
        system_prompt, user_prompt_template = _load_prompt_template(
            template_key=template_key,
            fallback_system=_SYSTEM_PROMPT,
            fallback_user=_FULL_ANALYSIS_PROMPT,
        )

        prompt = user_prompt_template.format(
            title=title,
            organization=organization or "未说明",
            location=location or "未说明",
            country=country or "未说明",
            closing_date=closing_date or "未说明",
            source=source,
            solicitation_number=solicitation_number or "未说明",
            description=desc_text or "无描述信息",
            document_text=doc_text or "无招标文件",
        )

        estimated_cost = estimate_analysis_cost(
            len(prompt) + len(system_prompt),
            self._max_tokens,
            self._model,
        )
        if estimated_cost > MAX_COST_PER_ANALYSIS:
            logger.warning(
                "Estimated cost $%.2f exceeds $%.2f limit — truncating input",
                estimated_cost, MAX_COST_PER_ANALYSIS,
            )
            doc_text = doc_text[:50000]
            prompt = user_prompt_template.format(
                title=title,
                organization=organization or "未说明",
                location=location or "未说明",
                country=country or "未说明",
                closing_date=closing_date or "未说明",
                source=source,
                solicitation_number=solicitation_number or "未说明",
                description=desc_text or "无描述信息",
                document_text=doc_text or "无招标文件",
            )

        logger.info(
            "Starting deep analysis: model=%s title='%s' desc=%d doc=%d est_cost=$%.3f",
            self._model, title[:80], len(desc_text), len(doc_text), estimated_cost,
        )

        try:
            client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
            response = client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.15,
                max_tokens=self._max_tokens,
                timeout=240,
            )

            usage = response.usage
            prompt_tokens = usage.prompt_tokens if usage else 0
            completion_tokens = usage.completion_tokens if usage else 0
            actual_cost = estimate_analysis_cost(0, 0, self._model)
            if prompt_tokens and completion_tokens:
                rates = _COST_PER_1M.get(self._model, (2.50, 10.00))
                actual_cost = round(
                    (prompt_tokens / 1_000_000) * rates[0]
                    + (completion_tokens / 1_000_000) * rates[1],
                    4,
                )

            raw_content = response.choices[0].message.content or ""
            structured_report = None
            report_md = raw_content
            try:
                maybe_json = raw_content.strip()
                if maybe_json.startswith("{") and maybe_json.endswith("}"):
                    parsed = json.loads(maybe_json)
                    if isinstance(parsed, dict):
                        structured_report = parsed
                        report_md = _structured_report_to_markdown(parsed)
            except Exception:
                structured_report = None

            logger.info(
                "Analysis complete: title='%s' tokens=%d+%d model=%s len=%d cost=$%.4f",
                title[:60], prompt_tokens, completion_tokens,
                self._model, len(report_md), actual_cost,
            )

            return {
                "report_markdown": report_md,
                "structured_report": structured_report,
                "model": self._model,
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "estimated_cost_usd": actual_cost,
                "fallback": False,
            }

        except Exception as exc:
            logger.error("AI analysis failed: %s (%s)", exc, type(exc).__name__)
            return self._fallback(title, description)

    @staticmethod
    def generate_mini_summary(
        title: str,
        description: str | None = None,
        organization: str | None = None,
        location: str | None = None,
        closing_date: str | None = None,
        prompt_template_key: str | None = None,
    ) -> str | None:
        if not settings.OPENAI_API_KEY:
            return None

        desc = (description or "")[:3000]
        if not desc and not title:
            return None

        template_key = prompt_template_key or "default.quick"
        system_prompt, user_prompt_template = _load_prompt_template(
            template_key=template_key,
            fallback_system=_SYSTEM_PROMPT,
            fallback_user=_MINI_SUMMARY_PROMPT,
        )

        prompt = user_prompt_template.format(
            title=title,
            organization=organization or "未说明",
            location=location or "未说明",
            closing_date=closing_date or "未说明",
            description=desc or "无详细描述",
        )

        try:
            client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=300,
                timeout=15,
            )
            return (response.choices[0].message.content or "").strip()
        except Exception as exc:
            logger.warning("Mini summary failed: %s", exc)
            return None

    def _prepare_documents(self, document_texts: dict[str, str] | None, max_total: int = 100000) -> str:
        if not document_texts:
            return ""

        file_docs = {}
        link_docs = {}
        for fname, txt in document_texts.items():
            fl = fname.lower()
            if any(fl.endswith(ext) for ext in (".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt")):
                file_docs[fname] = txt
            else:
                link_docs[fname] = txt

        ordered = list(file_docs.items()) + list(link_docs.items())

        parts: list[str] = []
        total = 0
        for fname, txt in ordered:
            chunk = txt[:max_total - total]
            if chunk:
                parts.append(f"\n--- Document: {fname} ---\n{chunk}")
                total += len(chunk)
            if total >= max_total:
                break

        return "".join(parts)

    def _fallback(self, title: str, description: str | None) -> dict[str, Any]:
        logger.warning("Using fallback for '%s'", title[:80])
        return {
            "report_markdown": (
                f"## {title}\n\n"
                "AI 分析暂时不可用。请稍后重试，或联系管理员检查 OpenAI API 配置。\n\n"
                f"**招标描述：**\n\n{(description or '无描述')[:2000]}"
            ),
            "model": "fallback",
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "estimated_cost_usd": 0.0,
            "fallback": True,
        }
