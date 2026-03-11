"""AI-powered Tender Intelligence Report generator.

Produces a structured 12-section bid analysis report that helps a window
covering / textile company decide whether to pursue a tender, using:
  - opportunity metadata
  - description text
  - document text (when available)

Three distinct feasibility dimensions are always assessed:
  1. Technical Feasibility — can we deliver the product/service?
  2. Bid Compliance Feasibility — would our bid be disqualified?
  3. Commercial Feasibility — is this financially and logistically viable?
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)

# ──────────────────────────────────────────────────────────────
# System prompt — role & business context
# ──────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a senior procurement intelligence analyst and bid advisor.

Your client is a North American window covering and textile furnishing company that:
- Supplies and installs blinds, roller shades, zebra blinds, motorized shades, solar shades, blackout shades, skylight shades
- Supplies curtains, drapery, privacy curtains, cubicle curtains, healthcare curtains
- Supplies fabric, textile, linen, bedding, hospitality linen
- Does FF&E (Furniture, Fixtures & Equipment) supply and installation
- Sources products from manufacturers in China for North American supply/install projects
- Focuses on commercial projects: hospitals, schools, hotels, government buildings, multi-residential

Your job is to produce a professional Tender Intelligence Report that helps the client make a bid/no-bid decision in under 60 seconds.

CRITICAL RULES:
- Never fabricate facts. If information is not in the tender data, say "Not specified in available documents."
- Always distinguish between technical feasibility, bid compliance feasibility, and commercial feasibility — they are NOT the same.
- If a mandatory requirement could disqualify the bid, flag it as a "fatal_blocker", "serious_risk", or "normal_requirement".
- Be direct, specific, and actionable. Every sentence should help the reader decide."""

# ──────────────────────────────────────────────────────────────
# Analysis prompt — 12-section report schema
# ──────────────────────────────────────────────────────────────

_ANALYSIS_PROMPT = """\
Analyze this tender opportunity and produce a Tender Intelligence Report as JSON.

OPPORTUNITY DATA:
Title: {title}
Organization: {organization}
Location: {location}
Country: {country}
Closing Date: {closing_date}
Response Deadline: {response_deadline}
Source: {source}
NAICS: {naics}
Category: {category}
Set-Aside: {set_aside}
Solicitation #: {solicitation_number}

DESCRIPTION / SCOPE:
{description}

DOCUMENT CONTENT (if available):
{document_text}

Respond with ONLY valid JSON matching this exact structure:
{{
  "report_version": "2.0",

  "verdict": {{
    "one_line": "One sentence: [Pursue/Review/Skip] — key reason for this recommendation",
    "recommendation": "pursue | review_carefully | low_probability | skip",
    "confidence": "high | medium | low | very_low",
    "confidence_rationale": "Why this confidence level (e.g. limited description, no documents)"
  }},

  "project_summary": {{
    "overview": "2-3 sentences: what the tender is about and what is being requested",
    "issuing_body": "Organization name and type (federal/state/municipal/education/healthcare)",
    "project_type": "new_construction | renovation | replacement | maintenance | supply_contract | service_contract | design_build | other"
  }},

  "scope_breakdown": {{
    "main_deliverables": ["List each major deliverable"],
    "quantities": "Specific quantities mentioned or 'Not specified'",
    "scope_type": "supply_only | install_only | supply_and_install | design_build | consulting | mixed | unclear",
    "service_scope": "Any service/maintenance/warranty scope beyond initial delivery",
    "intended_use": "Where/how the products will be used (hospital patient rooms, hotel guest rooms, office, etc.)"
  }},

  "technical_requirements": {{
    "product_requirements": ["Specific product specs, materials, finishes, performance criteria"],
    "environmental_requirements": ["Fire rating, antimicrobial, VOC, sustainability, LEED, etc."],
    "installation_requirements": ["Installation-specific requirements"],
    "standards_certifications": ["Required standards, codes, certifications (NFPA, ASTM, UL, CAN/CSA, etc.)"],
    "control_systems": "Motorization, automation, HVAC integration, building management systems if relevant",
    "specialized_needs": ["Any unique or unusual technical requirements"]
  }},

  "timeline_milestones": {{
    "bid_closing": "Bid submission deadline",
    "response_due": "Response / Q&A deadline if different",
    "site_visit": "Mandatory or optional site visit date, or null",
    "pre_bid_meeting": "Pre-bid meeting date, or null",
    "project_start": "Expected start, or null",
    "delivery_deadline": "Delivery/completion deadline, or null",
    "milestone_dates": ["Any other milestone dates mentioned"],
    "schedule_pressure": "realistic | moderate | tight | very_tight",
    "schedule_notes": "Assessment of whether the timeline is achievable given China sourcing + shipping"
  }},

  "evaluation_strategy": {{
    "pricing_weight": "Percentage or description of price evaluation weight, or 'Not specified'",
    "technical_weight": "Technical evaluation weight",
    "experience_weight": "Experience/references evaluation weight",
    "other_criteria": ["Any other evaluation criteria mentioned"],
    "likely_evaluator_focus": "What the evaluator will care most about based on the tender language"
  }},

  "business_fit": {{
    "fit_assessment": "strong_fit | moderate_fit | weak_fit | poor_fit",
    "fit_explanation": "2-3 sentences: why this does or doesn't fit the company's capabilities",
    "recommended_role": "prime_contractor | subcontractor | supplier_only | partner_required | not_recommended",
    "capability_gaps": ["Any gaps between our capabilities and tender requirements"]
  }},

  "compliance_risks": {{
    "red_flags": [
      {{
        "requirement": "Description of the requirement",
        "severity": "fatal_blocker | serious_risk | normal_requirement",
        "explanation": "Why this is a risk and what would be needed to mitigate it"
      }}
    ],
    "mandatory_certifications": ["List any mandatory certifications that could disqualify"],
    "experience_thresholds": "Required years/projects of experience, or 'Not specified'",
    "bonding_insurance": "Bid bond, performance bond, insurance minimums",
    "local_requirements": "Local business registration, union labor, apprenticeship requirements"
  }},

  "compatibility_analysis": {{
    "existing_system": "Whether the tender references an existing system, brand, processor, or platform",
    "brand_compatibility": "Whether specific brand/product compatibility is required or implied",
    "proof_required": "Whether OEM letters, datasheets, engineering validation, or compatibility proof would be needed",
    "compatibility_risk": "none | low | medium | high",
    "compatibility_notes": "Specific notes on what compatibility evidence would be needed"
  }},

  "supply_chain_feasibility": {{
    "china_sourcing_viable": true,
    "sourcing_explanation": "Can products realistically be sourced from China for this project?",
    "buy_domestic_restrictions": ["Buy America, Buy Canadian, or similar restrictions"],
    "shipping_lead_time": "Estimated manufacturing + shipping timeline vs project deadline",
    "warehousing_needs": "Any warehousing/staging requirements",
    "import_compliance": "Customs, tariffs, country-of-origin labeling requirements",
    "local_installation": "Whether local installers or partners would be needed"
  }},

  "participation_strategy": {{
    "recommended_approach": "pursue_as_prime | pursue_as_sub | pursue_with_partners | pursue_after_proof | skip",
    "strategy_rationale": "Why this approach is recommended",
    "potential_partners": "Types of partners needed (local installer, GC, specialty sub, etc.)",
    "competitive_positioning": "How to differentiate our bid"
  }},

  "required_evidence": {{
    "before_bidding": ["What must be confirmed/obtained before submitting a bid"],
    "with_submission": ["What documentation must be included in the bid package"],
    "examples": ["OEM compatibility letter", "product datasheets", "installer partner agreement", "insurance certificate", "bid bond"]
  }},

  "feasibility_scores": {{
    "technical_feasibility": 0,
    "compliance_feasibility": 0,
    "commercial_feasibility": 0,
    "overall_score": 0,
    "score_rationale": "Brief explanation of how the three dimensions combine"
  }}
}}

SCORING RULES:
- Each feasibility score is 0-100.
- overall_score = weighted average: technical 30% + compliance 30% + commercial 40%.
- If ANY dimension is below 20, set overall_score to max 25 regardless of other scores.
- If compliance_feasibility has a fatal_blocker in red_flags, cap compliance at 15."""


class TenderAnalyzer:
    """Generates structured Tender Intelligence Reports using OpenAI."""

    def __init__(self, model: str = "gpt-4o-mini") -> None:
        self._model = model

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

        desc_text = (description or "")[:6000]
        doc_text = self._prepare_documents(document_texts)

        if not desc_text and not doc_text:
            logger.warning("No description or documents to analyze for: %s", title)
            return self._fallback_analysis(title, description)

        prompt = _ANALYSIS_PROMPT.format(
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

        try:
            import openai
            client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
            response = client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=3500,
                response_format={"type": "json_object"},
            )
            raw = response.choices[0].message.content or "{}"
            result = json.loads(raw)

            result["analysis_model"] = self._model
            result["analyzed_at"] = datetime.now(timezone.utc).isoformat()
            result["report_version"] = result.get("report_version", "2.0")

            verdict = result.get("verdict", {})
            scores = result.get("feasibility_scores", {})
            logger.info(
                "Tender Intelligence Report complete for '%s': score=%s rec=%s conf=%s",
                title,
                scores.get("overall_score", "?"),
                verdict.get("recommendation", "?"),
                verdict.get("confidence", "?"),
            )
            return result

        except json.JSONDecodeError as exc:
            logger.error("Failed to parse AI response as JSON: %s", exc)
            return self._fallback_analysis(title, description)
        except Exception as exc:
            logger.error("AI analysis failed: %s", exc)
            return self._fallback_analysis(title, description)

    def _prepare_documents(self, document_texts: dict[str, str] | None) -> str:
        if not document_texts:
            return ""
        parts: list[str] = []
        total = 0
        for fname, text in document_texts.items():
            chunk = text[:5000]
            if total + len(chunk) > 15000:
                chunk = chunk[:max(0, 15000 - total)]
            if chunk:
                parts.append(f"\n--- Document: {fname} ---\n{chunk}")
                total += len(chunk)
            if total >= 15000:
                break
        return "".join(parts)

    def _fallback_analysis(self, title: str, description: str | None) -> dict[str, Any]:
        """Rule-based fallback when AI is unavailable."""
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
            "report_version": "2.0",
            "verdict": {
                "one_line": f"{'Review' if is_relevant else 'Skip'} — {'possible industry fit based on keywords' if is_relevant else 'no clear industry fit detected'}",
                "recommendation": rec,
                "confidence": conf,
                "confidence_rationale": "AI analysis unavailable; based on keyword matching only.",
            },
            "project_summary": {
                "overview": f"Tender: {title}",
                "issuing_body": "Not specified",
                "project_type": "other",
            },
            "scope_breakdown": {
                "main_deliverables": [],
                "quantities": "Not specified",
                "scope_type": "unclear",
                "service_scope": "Not specified",
                "intended_use": "Not specified",
            },
            "technical_requirements": {
                "product_requirements": [],
                "environmental_requirements": [],
                "installation_requirements": [],
                "standards_certifications": [],
                "control_systems": "Not specified",
                "specialized_needs": [],
            },
            "timeline_milestones": {
                "bid_closing": None, "response_due": None,
                "site_visit": None, "pre_bid_meeting": None,
                "project_start": None, "delivery_deadline": None,
                "milestone_dates": [],
                "schedule_pressure": "realistic",
                "schedule_notes": "Insufficient information to assess timeline.",
            },
            "evaluation_strategy": {
                "pricing_weight": "Not specified",
                "technical_weight": "Not specified",
                "experience_weight": "Not specified",
                "other_criteria": [],
                "likely_evaluator_focus": "Not specified",
            },
            "business_fit": {
                "fit_assessment": "moderate_fit" if is_relevant else "poor_fit",
                "fit_explanation": breakdown.get("business_fit_explanation", "Rule-based scoring only."),
                "recommended_role": "not_recommended" if not is_relevant else "supplier_only",
                "capability_gaps": [],
            },
            "compliance_risks": {
                "red_flags": [],
                "mandatory_certifications": [],
                "experience_thresholds": "Not specified",
                "bonding_insurance": "Not specified",
                "local_requirements": "Not specified",
            },
            "compatibility_analysis": {
                "existing_system": "Not specified",
                "brand_compatibility": "Not specified",
                "proof_required": "Not specified",
                "compatibility_risk": "none",
                "compatibility_notes": "Insufficient data to assess.",
            },
            "supply_chain_feasibility": {
                "china_sourcing_viable": True,
                "sourcing_explanation": "No restrictions identified (detailed analysis unavailable).",
                "buy_domestic_restrictions": [],
                "shipping_lead_time": "Not assessed",
                "warehousing_needs": "Not specified",
                "import_compliance": "Not specified",
                "local_installation": "Not specified",
            },
            "participation_strategy": {
                "recommended_approach": "skip" if not is_relevant else "pursue_after_proof",
                "strategy_rationale": "Manual review recommended — AI analysis was unavailable.",
                "potential_partners": "Not assessed",
                "competitive_positioning": "Not assessed",
            },
            "required_evidence": {
                "before_bidding": ["Manual review of tender documents required"],
                "with_submission": [],
                "examples": [],
            },
            "feasibility_scores": {
                "technical_feasibility": feas,
                "compliance_feasibility": feas,
                "commercial_feasibility": feas,
                "overall_score": feas,
                "score_rationale": "Approximate score from keyword matching; AI analysis unavailable.",
            },
            "analysis_model": "fallback_rule_based",
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }
