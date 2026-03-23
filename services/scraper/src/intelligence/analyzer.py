"""AI-powered Tender Intelligence Report generator (v4 — Markdown output).

Produces a comprehensive bid analysis report in Chinese Markdown that helps
a window covering company decide whether to pursue a tender.

Two modes:
  1. Full analysis (gpt-4o): employee uploads bid documents, AI produces a
     detailed Markdown report covering all aspects of the opportunity.
  2. Mini summary (gpt-4o-mini): lightweight 2-3 sentence assessment based
     on crawled description data, shown on the summary tab.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import openai

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)

# ──────────────────────────────────────────────────────────────
# System prompt — role & business context (shared)
# ──────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
你是一位资深的政府采购情报分析师和投标策略顾问，擅长北美政府/机构采购合同的深度分析。

你的客户是一家北美窗饰遮阳产品制造安装公司，具体业务包括：
- 供应与安装：百叶窗、卷帘、斑马帘、电动遮阳帘、太阳能遮阳帘、遮光帘、天窗遮阳系统
- 供应与安装：窗帘、窗幔、隐私帘、医院隔帘、办公隔断帘
- FF&E（家具、固定装置与设备）整体供应与安装
- 从中国制造商采购产品，在北美完成供应/安装项目
- 主要服务商业项目：医院、学校、酒店、政府大楼、多户住宅

核心规则：
- 所有输出必须使用简体中文
- 绝不编造事实。如果招标文件中没有相关信息，明确说明"招标文件未说明"
- 直接、具体、可操作。每一句话都要帮助读者做出投标/不投标的决定
- 当有文档原文时，深入挖掘具体规格、数量、条款编号，并引用来源
- 以"如果你是这家公司的老板"的视角给出投标策略建议"""

# ──────────────────────────────────────────────────────────────
# Full analysis prompt — Markdown report
# ──────────────────────────────────────────────────────────────

_FULL_ANALYSIS_PROMPT = """\
分析以下招标项目及其全部附件文档，产出一份**完整、详尽、专业**的中文《招标情报分析报告》。

请以 Markdown 格式输出，结构清晰，内容丰富。这份报告将直接展示给投标团队，指导他们的投标决策。

招标基本信息：
- 标题: {title}
- 采购机构: {organization}
- 地点: {location}
- 国家: {country}
- 截标日期: {closing_date}
- 来源平台: {source}
- 招标编号: {solicitation_number}

招标描述/范围：
{description}

招标文件原文：
{document_text}

---

**报告要求：**

请按以下大纲撰写报告（可根据内容丰富程度适当增减小节）：

## 一句话结论
用一句话给出投标建议：建议投标 / 谨慎评估 / 不建议投标，并说明核心理由。

## 项目概述
该招标的核心内容、采购机构背景、项目类型与规模。

## 需求范围详解
主要交付物、具体数量、规格要求、安装还是供货、服务范围。引用文档中的具体条款和数据。

## 技术要求分析
产品规格、材料要求、性能标准、认证要求（NFPA、ASTM、CSA等）、环保要求、电动化/自动化需求等。逐条分析我司是否能满足。

## 时间线与关键日期
投标截止、现场踏勘、开工日期、交付期限。评估时间线是否考虑了中国采购+海运周期。

## 评标标准与策略
价格权重、技术权重、经验权重。针对每个评标维度给出得分最大化建议。

## 我司匹配度评估
从产品能力、安装能力、项目经验、资质证书等方面，评估我司与该项目的匹配程度。

## 合规风险与红线
可能导致投标被取消资格的强制要求、保函保险要求、本地化要求、经验门槛等。标记致命风险。

## 供应链与中国采购可行性
从中国采购是否可行？有无 Buy America/Buy Canadian 限制？海运周期是否匹配项目进度？

## 竞争分析与差异化
推荐的参与方式（主承包/分包/合作），如何形成差异化竞争优势。

## 投标策略 GO/NO-GO 决策
综合评估投标/不投标的决策依据、中标概率、定价策略建议。

## 团队待办清单
投标前必须完成的具体事项，包含负责人建议和时间节点。

---

**注意事项：**
- 如果有招标文件原文，必须深入引用具体条款、页码、规格编号
- 对关键限制性条款（保证金、资质、取消条件），请逐字引用英文原文并附中文解释
- 不要空泛。每一段都应包含具体的、可操作的信息
- 如某方面信息不足，明确说明"招标文件未说明"，不要编造"""

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


class TenderAnalyzer:
    """Generates Tender Intelligence Reports using OpenAI."""

    def __init__(self, model: str = "gpt-4o", max_tokens: int = 8000) -> None:
        self._model = model
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
    ) -> dict[str, Any]:
        """Run full AI analysis and return a Markdown report.

        Returns {"report_markdown": str, "model": str, "analyzed_at": str,
                 "prompt_tokens": int, "completion_tokens": int, "fallback": bool}
        """
        if not settings.OPENAI_API_KEY:
            logger.error("OPENAI_API_KEY not configured")
            return self._fallback(title, description)

        desc_text = (description or "")[:20000]
        doc_text = self._prepare_documents(document_texts, max_total=80000)

        if not desc_text and not doc_text:
            logger.warning("No content to analyze for: %s", title)
            return self._fallback(title, description)

        prompt = _FULL_ANALYSIS_PROMPT.format(
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
            "Starting Markdown analysis: model=%s title='%s' desc=%d doc=%d",
            self._model, title[:80], len(desc_text), len(doc_text),
        )

        try:
            client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
            response = client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=self._max_tokens,
                timeout=120,
            )

            usage = response.usage
            prompt_tokens = usage.prompt_tokens if usage else 0
            completion_tokens = usage.completion_tokens if usage else 0

            report_md = response.choices[0].message.content or ""

            logger.info(
                "Analysis complete: title='%s' tokens=%d+%d model=%s len=%d",
                title[:60], prompt_tokens, completion_tokens, self._model, len(report_md),
            )

            return {
                "report_markdown": report_md,
                "model": self._model,
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
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
    ) -> str | None:
        """Generate a lightweight 2-3 sentence assessment using gpt-4o-mini.

        Returns the summary text, or None on failure.
        """
        if not settings.OPENAI_API_KEY:
            return None

        desc = (description or "")[:3000]
        if not desc and not title:
            return None

        prompt = _MINI_SUMMARY_PROMPT.format(
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
                    {"role": "system", "content": _SYSTEM_PROMPT},
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

    def _prepare_documents(self, document_texts: dict[str, str] | None, max_total: int = 80000) -> str:
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
        """Simple fallback when AI is unavailable."""
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
            "fallback": True,
        }
