"""AI-powered Tender Intelligence Report generator (v3 — Chinese output).

Produces a structured bid analysis report in Chinese that helps a window
covering company decide whether to pursue a tender, using:
  - opportunity metadata
  - description text
  - document text (when available, including addenda)

Three distinct feasibility dimensions are always assessed:
  1. Technical Feasibility — can we deliver the product/service?
  2. Bid Compliance Feasibility — would our bid be disqualified?
  3. Commercial Feasibility — is this financially and logistically viable?

v3 additions over v2:
  - All report text output in Chinese (Simplified)
  - bid_strategy section: go/no-go, pricing, scoring optimization
  - addendum_analysis section: per-addendum change tracking
  - company_specific_risks: risks mapped to our actual capabilities
  - action_items: concrete next steps for the team
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import openai

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)

_openai_available = True

# ──────────────────────────────────────────────────────────────
# System prompt — role & business context
# ──────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
你是一位资深的政府采购情报分析师和投标策略顾问，擅长北美政府/机构采购合同的深度分析。

你的客户是一家北美窗饰遮阳产品制造安装公司，具体业务包括：
- 供应与安装：百叶窗、卷帘、斑马帘、电动遮阳帘、太阳能遮阳帘、遮光帘、天窗遮阳系统
- 供应与安装：窗帘、窗幔、隐私帘、医院隔帘、办公隔断帘
- FF&E（家具、固定装置与设备）整体供应与安装
- 从中国制造商采购产品，在北美完成供应/安装项目
- 主要服务商业项目：医院、学校、酒店、政府大楼、多户住宅

你的任务是以**投标操盘手**的视角，用中文产出一份专业、详尽、可直接指导投标决策的《招标情报分析报告》。

核心规则：
- 所有输出内容必须使用简体中文
- 绝不编造事实。如果招标文件中没有相关信息，明确说明"招标文件未说明"
- 始终区分三个可行性维度：技术可行性、合规可行性、商业可行性——它们是不同的
- 如果某项强制要求可能导致投标被取消资格，标记为 "fatal_blocker"（致命阻断）、"serious_risk"（严重风险）或 "normal_requirement"（常规要求）
- 直接、具体、可操作。每一句话都要帮助读者做出投标/不投标的决定
- 当有文档原文时，必须深入挖掘：具体产品规格、数量、房间数、材料要求、品牌指定、条款编号、截止日期、评标权重
- 必须引用来源：引用文档名称和章节编号（如"根据RFP第5.2条..."或"参见附件H..."）
- 对影响投标决策的关键条款，必须逐字引用原文（保证金要求、限制条款、强制资质、取消资格条件）
- 以"如果你是这家公司的老板"的视角给出投标策略建议"""

# ──────────────────────────────────────────────────────────────
# Analysis prompt — 12-section report schema
# ──────────────────────────────────────────────────────────────

_ANALYSIS_PROMPT = """\
分析以下招标项目，产出一份中文《招标情报分析报告》，以 JSON 格式返回。

招标基本信息：
标题: {title}
采购机构: {organization}
地点: {location}
国家: {country}
截标日期: {closing_date}
答复截止: {response_deadline}
来源平台: {source}
NAICS: {naics}
分类: {category}
限制条件: {set_aside}
招标编号: {solicitation_number}

招标描述/范围：
{description}

招标文件原文（如有）：
{document_text}

请仅返回有效的 JSON，严格符合以下结构（所有文本值用简体中文）：
{{
  "report_version": "3.0",

  "verdict": {{
    "one_line": "一句话结论：[建议投标/谨慎评估/不建议投标] — 核心理由",
    "recommendation": "pursue | review_carefully | low_probability | skip",
    "confidence": "high | medium | low | very_low",
    "confidence_rationale": "为什么是这个置信度（如：仅有描述无文档、文档内容详尽等）"
  }},

  "project_summary": {{
    "overview": "2-3句：该招标的核心内容和需求概述",
    "issuing_body": "采购机构名称与类型（联邦/州省/市政/教育/医疗）",
    "project_type": "new_construction | renovation | replacement | maintenance | supply_contract | service_contract | design_build | other"
  }},

  "scope_breakdown": {{
    "main_deliverables": ["逐项列出主要交付物"],
    "quantities": "具体数量（如有）或'招标文件未说明'",
    "scope_type": "supply_only | install_only | supply_and_install | design_build | consulting | mixed | unclear",
    "service_scope": "超出初始交付的服务/维保范围",
    "intended_use": "产品用于何处（医院病房、酒店客房、办公室等）"
  }},

  "technical_requirements": {{
    "product_requirements": ["具体产品规格、材料、饰面、性能标准"],
    "environmental_requirements": ["防火等级、抗菌、VOC、LEED等环保要求"],
    "installation_requirements": ["安装相关的具体要求"],
    "standards_certifications": ["必须满足的标准/规范/认证（NFPA、ASTM、UL、CAN/CSA等）"],
    "control_systems": "电动化、自动化、暖通联动、楼宇管理系统（如相关）",
    "specialized_needs": ["任何独特或不寻常的技术要求"]
  }},

  "timeline_milestones": {{
    "bid_closing": "投标截止日期",
    "response_due": "答疑截止日期（如不同）",
    "site_visit": "现场踏勘日期（强制/自选），或 null",
    "pre_bid_meeting": "投标前会议日期，或 null",
    "project_start": "预计开工日期，或 null",
    "delivery_deadline": "交付/竣工期限，或 null",
    "milestone_dates": ["其他里程碑日期"],
    "schedule_pressure": "realistic | moderate | tight | very_tight",
    "schedule_notes": "时间线评估：考虑中国采购+海运周期，是否可行"
  }},

  "evaluation_strategy": {{
    "pricing_weight": "价格评分权重百分比，或'招标文件未说明'",
    "technical_weight": "技术评分权重",
    "experience_weight": "经验/业绩评分权重",
    "other_criteria": ["其他评标标准"],
    "likely_evaluator_focus": "根据招标语言判断评委最关注什么",
    "scoring_optimization": ["针对每个评标维度的得分最大化建议"]
  }},

  "business_fit": {{
    "fit_assessment": "strong_fit | moderate_fit | weak_fit | poor_fit",
    "fit_explanation": "2-3句：为什么该项目适合/不适合我们公司的能力",
    "recommended_role": "prime_contractor | subcontractor | supplier_only | partner_required | not_recommended",
    "capability_gaps": ["我们能力与招标要求之间的差距"]
  }},

  "compliance_risks": {{
    "red_flags": [
      {{
        "requirement": "要求描述",
        "severity": "fatal_blocker | serious_risk | normal_requirement",
        "explanation": "为什么这是风险，需要什么来化解"
      }}
    ],
    "mandatory_certifications": ["可能导致取消资格的强制认证"],
    "experience_thresholds": "要求的年限/项目数，或'招标文件未说明'",
    "bonding_insurance": "投标保函、履约保函、保险要求",
    "local_requirements": "本地注册、工会、学徒制要求"
  }},

  "compatibility_analysis": {{
    "existing_system": "是否涉及现有系统、品牌指定或平台兼容",
    "brand_compatibility": "是否要求特定品牌兼容",
    "proof_required": "是否需要OEM授权函、数据表、工程验证等兼容性证明",
    "compatibility_risk": "none | low | medium | high",
    "compatibility_notes": "需要什么兼容性证据的具体说明"
  }},

  "supply_chain_feasibility": {{
    "china_sourcing_viable": true,
    "sourcing_explanation": "从中国采购对该项目是否现实可行？",
    "buy_domestic_restrictions": ["Buy America、Buy Canadian 或类似限制条款"],
    "shipping_lead_time": "预估生产+海运周期 vs 项目截止时间",
    "warehousing_needs": "仓储/暂存需求",
    "import_compliance": "海关、关税、原产地标签要求",
    "local_installation": "是否需要当地安装商或合作伙伴"
  }},

  "participation_strategy": {{
    "recommended_approach": "pursue_as_prime | pursue_as_sub | pursue_with_partners | pursue_after_proof | skip",
    "strategy_rationale": "为什么推荐这种参与方式",
    "potential_partners": "需要的合作伙伴类型（当地安装商、总包、专业分包等）",
    "competitive_positioning": "如何在投标中形成差异化优势"
  }},

  "bid_strategy": {{
    "go_no_go": "建议投标 | 谨慎评估 | 不建议投标",
    "go_no_go_rationale": "结合公司能力的详细投标/不投标决策依据",
    "pricing_strategy": "定价策略建议（如：技术占35%价格占30%，建议采用...策略）",
    "scoring_optimization": ["如何在每个评标维度最大化得分的具体建议"],
    "executive_summary_outline": "投标文件执行摘要的建议要点",
    "differentiation_points": ["区别于竞争对手的核心优势"],
    "win_probability": "high | medium | low | very_low",
    "win_probability_rationale": "中标概率评估理由"
  }},

  "addendum_analysis": [
    {{
      "number": "Addendum 编号",
      "key_changes": ["该 Addendum 的关键变更"],
      "impact": "对投标策略的影响"
    }}
  ],

  "company_specific_risks": [
    {{
      "risk": "风险描述（如：倾斜天窗需要张紧系统）",
      "severity": "high | medium | low",
      "mitigation": "应对方案（如：若有成熟天窗系统可投，否则风险大）"
    }}
  ],

  "action_items": [
    {{
      "action": "具体待办事项（如：准备3个类似医院项目案例）",
      "responsible": "建议负责人/角色",
      "deadline": "建议完成时间",
      "priority": "high | medium | low"
    }}
  ],

  "required_evidence": {{
    "before_bidding": ["投标前必须确认/获取的事项"],
    "with_submission": ["投标文件中必须包含的文档"],
    "examples": ["OEM授权函", "产品数据表", "安装商合作协议", "保险证明", "投标保函"]
  }},

  "feasibility_scores": {{
    "technical_feasibility": 0,
    "compliance_feasibility": 0,
    "commercial_feasibility": 0,
    "overall_score": 0,
    "score_rationale": "三个维度综合评估简述"
  }},

  "documents_analyzed": {{
    "count": 0,
    "names": ["已分析的文档清单"],
    "coverage_note": "文档完整度说明 — 如'完整RFQ包'或'仅有描述，无附件'"
  }},

  "evidence_quotes": [
    {{
      "document": "文档名称",
      "section": "章节/页码",
      "quote": "原文引用（保留英文原文）",
      "relevance": "该引用对投标决策的重要性"
    }}
  ]
}}

评分规则：
- 每个可行性维度 0-100 分
- overall_score = 加权平均：技术 30% + 合规 30% + 商业 40%
- 如果任一维度低于 20 分，overall_score 最高不超过 25 分
- 如果 compliance_risks 中有 fatal_blocker，合规得分上限为 15 分"""


_DEEP_CITATION_ADDENDUM = """

深度分析指令（文档感知模式）：
你已获得完整招标文件原文。你必须执行以下操作：
1. 引用具体文档名称和章节（如："根据[文档: Spec_Sheet.pdf]第3.2节..."）
2. 提取精确的规格编号、条款编号、数量数据
3. 识别招标描述与文档正文之间的矛盾之处
4. 在 technical_requirements.product_requirements 中，尽可能引用原文规格描述
5. 在 compliance_risks.red_flags 中，引用产生风险的具体文档和条款
6. 在 timeline_milestones 中，从文档提取精确日期而非从描述推断
7. 如果文档含有详细规格，提高置信度；如果文档模糊或仅为程序性内容，降低置信度
8. evidence_quotes 数组必须包含至少 3-5 条对投标决策至关重要的文档直接引用。逐字保留英文原文并加中文说明。包含最重要的规格、要求、限制条款和评标标准
9. 准确填写 documents_analyzed，列出所有已分析文档及完整度评估
10. 在 scope_breakdown.quantities 中提取精确数量——房间数、单位数、面积、线性英尺等
11. 在 evaluation_strategy 中提取精确的权重百分比和评分标准
12. 搜索隐藏要求：保险最低限额、保函金额、安全许可、工资标准（Davis-Bacon）、Buy American条款
13. 在 bid_strategy.scoring_optimization 中，针对文档中明确的每个评标维度给出得分最大化策略
14. 在 addendum_analysis 中，如果文档包含addendum/修正案内容，逐一分析其关键变化及对投标的影响
15. 在 action_items 中，给出团队需要立即执行的具体待办清单，包含负责人建议和时间节点
"""


class TenderAnalyzer:
    """Generates structured Tender Intelligence Reports using OpenAI."""

    def __init__(self, model: str = "gpt-4o-mini", max_tokens: int = 3500) -> None:
        self._model = model
        self._max_tokens = max_tokens

    def analyze(
        self,
        title: str,
        organization: str | None = None,
        location: str | None = None,
        closing_date: str | None = None,
        source: str = "SAM.gov",
        description: str | None = None,
        document_texts: dict[str, str] | None = None,
        *,
        country: str | None = None,
        response_deadline: str | None = None,
        naics: str | None = None,
        category: str | None = None,
        set_aside: str | None = None,
        solicitation_number: str | None = None,
    ) -> dict[str, Any]:
        """Run AI analysis and return a structured Tender Intelligence Report.

        Returns a dict conforming to the v2.0 report schema with 12 sections.
        Falls back to rule-based scoring if OpenAI is unavailable.
        """
        if not settings.OPENAI_API_KEY:
            logger.error("OPENAI_API_KEY not configured — cannot run AI analysis")
            return self._fallback_analysis(title, description)

        is_deep = self._model in ("gpt-4o", "gpt-4o-2024-11-20")
        desc_limit = 20000 if is_deep else 8000
        doc_limit = 60000 if is_deep else 20000
        desc_text = (description or "")[:desc_limit]
        doc_text = self._prepare_documents(document_texts, max_total=doc_limit)

        if not desc_text and not doc_text:
            logger.warning("No description or documents to analyze for: %s", title)
            return self._fallback_analysis(title, description)

        analysis_prompt = _ANALYSIS_PROMPT
        if is_deep and doc_text:
            analysis_prompt += _DEEP_CITATION_ADDENDUM

        prompt = analysis_prompt.format(
            title=title,
            organization=organization or "Not specified",
            location=location or "Not specified",
            country=country or "Not specified",
            closing_date=closing_date or "Not specified",
            response_deadline=response_deadline or "Not specified",
            source=source,
            naics=naics or "Not specified",
            category=category or "Not specified",
            set_aside=set_aside or "Not specified",
            solicitation_number=solicitation_number or "Not specified",
            description=desc_text or "Not available",
            document_text=doc_text or "No documents available",
        )

        logger.info(
            "Starting OpenAI analysis: model=%s title='%s' desc_len=%d doc_len=%d",
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
                temperature=0.2,
                max_tokens=self._max_tokens,
                response_format={"type": "json_object"},
                timeout=90,
            )

            usage = response.usage
            prompt_tokens = 0
            completion_tokens = 0
            if usage:
                prompt_tokens = usage.prompt_tokens
                completion_tokens = usage.completion_tokens
                logger.info(
                    "OpenAI token usage: prompt=%d completion=%d total=%d",
                    prompt_tokens, completion_tokens, usage.total_tokens,
                )

            raw = response.choices[0].message.content or "{}"
            result = json.loads(raw)

            result["analysis_model"] = self._model
            result["analyzed_at"] = datetime.now(timezone.utc).isoformat()
            result["report_version"] = result.get("report_version", "3.0")
            result["fallback_used"] = False
            result["_prompt_tokens"] = prompt_tokens
            result["_completion_tokens"] = completion_tokens

            verdict = result.get("verdict", {})
            scores = result.get("feasibility_scores", {})
            logger.info(
                "Tender Intelligence Report complete for '%s': score=%s rec=%s conf=%s model=%s",
                title,
                scores.get("overall_score", "?"),
                verdict.get("recommendation", "?"),
                verdict.get("confidence", "?"),
                self._model,
            )
            return result

        except json.JSONDecodeError as exc:
            logger.error("Failed to parse OpenAI response as JSON: %s", exc)
            return self._fallback_analysis(title, description)
        except openai.AuthenticationError as exc:
            logger.error("OpenAI authentication failed — check OPENAI_API_KEY: %s", exc)
            return self._fallback_analysis(title, description)
        except openai.RateLimitError as exc:
            logger.error("OpenAI rate limit hit: %s", exc)
            return self._fallback_analysis(title, description)
        except openai.APITimeoutError as exc:
            logger.error("OpenAI request timed out: %s", exc)
            return self._fallback_analysis(title, description)
        except Exception as exc:
            logger.error("AI analysis failed unexpectedly: %s (type: %s)", exc, type(exc).__name__)
            return self._fallback_analysis(title, description)

    def _prepare_documents(self, document_texts: dict[str, str] | None, max_total: int = 20000) -> str:
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

        file_budget = int(max_total * 0.8) if link_docs else max_total
        link_budget = max_total - file_budget

        parts: list[str] = []
        total = 0

        for fname, txt in ordered:
            is_file = fname in file_docs
            budget = file_budget if is_file else (file_budget + link_budget)
            per_doc = min(budget // max(len(file_docs if is_file else link_docs), 1), budget - total)
            chunk = txt[:per_doc]
            if total + len(chunk) > max_total:
                chunk = chunk[:max(0, max_total - total)]
            if chunk:
                parts.append(f"\n--- Document: {fname} ---\n{chunk}")
                total += len(chunk)
            if total >= max_total:
                break

        return "".join(parts)

    def _fallback_analysis(self, title: str, description: str | None) -> dict[str, Any]:
        """Rule-based fallback when AI is unavailable."""
        logger.warning("Using FALLBACK rule-based analysis for '%s' — OpenAI was not used", title[:80])
        from src.utils.scorer import score_opportunity

        desc = description or ""
        score, breakdown = score_opportunity(
            title=title, description=desc, org_type=None,
            project_type=None, category=None, source_fit_score=70,
        )
        is_relevant = score >= 40
        rec = "review_carefully" if is_relevant else "skip"
        conf = "very_low"
        feas = min(score, 100)

        return {
            "report_version": "3.0",
            "verdict": {
                "one_line": f"{'谨慎评估' if is_relevant else '不建议投标'} — {'关键词匹配显示可能相关' if is_relevant else '未检测到明确行业匹配'}",
                "recommendation": rec,
                "confidence": conf,
                "confidence_rationale": "AI分析不可用，仅基于关键词匹配。",
            },
            "project_summary": {
                "overview": f"招标项目：{title}",
                "issuing_body": "招标文件未说明",
                "project_type": "other",
            },
            "scope_breakdown": {
                "main_deliverables": [],
                "quantities": "招标文件未说明",
                "scope_type": "unclear",
                "service_scope": "招标文件未说明",
                "intended_use": "招标文件未说明",
            },
            "technical_requirements": {
                "product_requirements": [],
                "environmental_requirements": [],
                "installation_requirements": [],
                "standards_certifications": [],
                "control_systems": "招标文件未说明",
                "specialized_needs": [],
            },
            "timeline_milestones": {
                "bid_closing": None, "response_due": None,
                "site_visit": None, "pre_bid_meeting": None,
                "project_start": None, "delivery_deadline": None,
                "milestone_dates": [],
                "schedule_pressure": "realistic",
                "schedule_notes": "信息不足，无法评估时间线。",
            },
            "evaluation_strategy": {
                "pricing_weight": "招标文件未说明",
                "technical_weight": "招标文件未说明",
                "experience_weight": "招标文件未说明",
                "other_criteria": [],
                "likely_evaluator_focus": "招标文件未说明",
                "scoring_optimization": [],
            },
            "business_fit": {
                "fit_assessment": "moderate_fit" if is_relevant else "poor_fit",
                "fit_explanation": breakdown.get("business_fit_explanation", "仅基于规则评分。"),
                "recommended_role": "not_recommended" if not is_relevant else "supplier_only",
                "capability_gaps": [],
            },
            "compliance_risks": {
                "red_flags": [],
                "mandatory_certifications": [],
                "experience_thresholds": "招标文件未说明",
                "bonding_insurance": "招标文件未说明",
                "local_requirements": "招标文件未说明",
            },
            "compatibility_analysis": {
                "existing_system": "招标文件未说明",
                "brand_compatibility": "招标文件未说明",
                "proof_required": "招标文件未说明",
                "compatibility_risk": "none",
                "compatibility_notes": "数据不足，无法评估。",
            },
            "supply_chain_feasibility": {
                "china_sourcing_viable": True,
                "sourcing_explanation": "未发现限制条款（详细分析不可用）。",
                "buy_domestic_restrictions": [],
                "shipping_lead_time": "未评估",
                "warehousing_needs": "招标文件未说明",
                "import_compliance": "招标文件未说明",
                "local_installation": "招标文件未说明",
            },
            "participation_strategy": {
                "recommended_approach": "skip" if not is_relevant else "pursue_after_proof",
                "strategy_rationale": "建议人工审核——AI分析不可用。",
                "potential_partners": "未评估",
                "competitive_positioning": "未评估",
            },
            "bid_strategy": {
                "go_no_go": "谨慎评估" if is_relevant else "不建议投标",
                "go_no_go_rationale": "AI分析不可用，建议人工审核后决定。",
                "pricing_strategy": "未评估",
                "scoring_optimization": [],
                "executive_summary_outline": "未评估",
                "differentiation_points": [],
                "win_probability": "very_low",
                "win_probability_rationale": "信息不足，无法评估中标概率。",
            },
            "addendum_analysis": [],
            "company_specific_risks": [],
            "action_items": [],
            "required_evidence": {
                "before_bidding": ["需要人工审核招标文件"],
                "with_submission": [],
                "examples": [],
            },
            "feasibility_scores": {
                "technical_feasibility": feas,
                "compliance_feasibility": feas,
                "commercial_feasibility": feas,
                "overall_score": feas,
                "score_rationale": "基于关键词匹配的近似评分；AI分析不可用。",
            },
            "analysis_model": "fallback_rule_based",
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "fallback_used": True,
        }
