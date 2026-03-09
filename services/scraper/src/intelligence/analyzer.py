"""AI-powered tender intelligence analysis.

Uses OpenAI GPT to extract structured intelligence from tender documents
and opportunity descriptions. Produces:
  - Project overview and scope
  - Technical requirements
  - Qualification requirements
  - Critical dates
  - Risk factors
  - Business feasibility assessment
  - China sourcing analysis
  - Actionable recommendation
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)

_SYSTEM_PROMPT = """You are a senior procurement analyst specializing in the North American window covering, blinds, curtains, textile, and interior furnishing industry.

Your job is to analyze tender/bid documents and opportunity descriptions to produce structured intelligence for a company that:
- Supplies and installs blinds, roller shades, zebra blinds, motorized shades, solar shades, blackout shades, skylight shades
- Supplies curtains, drapery, privacy curtains, cubicle curtains, healthcare curtains
- Supplies fabric, textile, linen, bedding, hospitality linen
- Does FF&E (Furniture, Fixtures & Equipment) supply and installation
- Sources products from China for North American supply/install projects
- Focuses on commercial projects: hospitals, schools, hotels, government buildings, multi-residential

You must produce actionable intelligence that helps the company decide whether to pursue the opportunity."""

_ANALYSIS_PROMPT = """Analyze this tender/bid opportunity and produce a JSON response with the following structure. Be specific and actionable.

OPPORTUNITY TITLE: {title}
ORGANIZATION: {organization}
LOCATION: {location}
CLOSING DATE: {closing_date}
SOURCE: {source}

DESCRIPTION / SCOPE:
{description}

DOCUMENT CONTENT (if available):
{document_text}

Respond with ONLY valid JSON in this exact structure:
{{
  "project_overview": "2-3 sentence summary of the project",
  "scope_of_work": "Detailed description of what is being procured/contracted",
  "scope_type": "One of: supply_only, install_only, supply_and_install, design_build, consulting, mixed, unclear",
  "technical_requirements": {{
    "materials": ["List of specific materials, products, or specifications mentioned"],
    "measurements": "Any dimensions, quantities, or sizing requirements",
    "compliance": ["Standards, codes, or certifications required"],
    "specialized_needs": ["Any unique technical requirements"]
  }},
  "qualification_requirements": {{
    "experience_years": "Required years of experience or 'not specified'",
    "certifications": ["Required certifications or licenses"],
    "insurance_min": "Minimum insurance requirements or 'not specified'",
    "labor_requirements": "Local labor, union, or apprenticeship requirements",
    "bonding": "Bid bond or performance bond requirements",
    "security_clearance": "Any security clearance needed",
    "other": ["Any other qualification requirements"]
  }},
  "critical_dates": {{
    "posting_date": "When the opportunity was posted",
    "closing_date": "Bid submission deadline",
    "site_visit_date": "Mandatory or optional site visit date, or null",
    "pre_bid_meeting": "Pre-bid meeting date, or null",
    "project_start": "Expected project start, or null",
    "project_completion": "Expected completion, or null",
    "timeline_notes": "Any other timeline information"
  }},
  "risk_factors": [
    "List each identified risk as a string, e.g. 'Tight 2-week deadline', 'Requires local union labor', 'Complex installation in occupied hospital'"
  ],
  "window_covering_relevance": {{
    "is_relevant": true/false,
    "relevance_explanation": "Why this is or isn't relevant to a window covering/textile company",
    "specific_products": ["blinds", "shades", etc. — specific products this tender needs],
    "estimated_scope_percentage": "What percentage of the project scope involves window coverings/textiles (0-100)"
  }},
  "feasibility_assessment": {{
    "feasibility_score": 0-100,
    "recommendation": "One of: strongly_pursue, pursue, review_carefully, low_probability, skip",
    "business_fit_explanation": "2-3 sentences explaining why this score and recommendation",
    "key_concerns": ["List top concerns"],
    "key_advantages": ["List top advantages for pursuing"]
  }},
  "china_sourcing_analysis": {{
    "viable": true/false,
    "explanation": "Can products be sourced from China? Are there Buy America/Canadian requirements?",
    "restrictions": ["List any sourcing restrictions"],
    "lead_time_concern": "Is timeline compatible with China manufacturing + shipping?"
  }},
  "recommended_action": "One paragraph summarizing whether to pursue and what steps to take"
}}"""


class TenderAnalyzer:
    """Analyzes tender opportunities using OpenAI GPT."""

    def __init__(self, model: str = "gpt-4o-mini") -> None:
        self._model = model

    def analyze(
        self,
        title: str,
        organization: str | None = None,
        location: str | None = None,
        closing_date: str | None = None,
        source: str = "MERX",
        description: str | None = None,
        document_texts: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Run full AI analysis on a tender opportunity.

        Args:
            title: Opportunity title.
            organization: Issuing organization name.
            location: Location / region.
            closing_date: Bid submission deadline.
            source: Source portal name.
            description: Opportunity description text.
            document_texts: Dict mapping filename → extracted text.

        Returns:
            Structured intelligence dict with all analysis fields.
        """
        if not settings.OPENAI_API_KEY:
            logger.error("OPENAI_API_KEY not configured — cannot run AI analysis")
            return self._fallback_analysis(title, description)

        doc_text = ""
        if document_texts:
            for fname, text in document_texts.items():
                # Limit each doc to ~4000 chars to stay within context
                truncated = text[:4000] if len(text) > 4000 else text
                doc_text += f"\n--- Document: {fname} ---\n{truncated}\n"

        if not doc_text and not description:
            logger.warning("No description or documents to analyze for: %s", title)
            return self._fallback_analysis(title, description)

        prompt = _ANALYSIS_PROMPT.format(
            title=title,
            organization=organization or "Unknown",
            location=location or "Unknown",
            closing_date=closing_date or "Unknown",
            source=source,
            description=(description or "Not available")[:3000],
            document_text=doc_text[:12000] if doc_text else "No documents available",
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
                temperature=0.3,
                max_tokens=2000,
                response_format={"type": "json_object"},
            )
            raw_text = response.choices[0].message.content or "{}"
            result = json.loads(raw_text)
            result["analysis_model"] = self._model
            result["analyzed_at"] = datetime.now(timezone.utc).isoformat()
            logger.info(
                "AI analysis complete for '%s': feasibility=%s, recommendation=%s",
                title,
                result.get("feasibility_assessment", {}).get("feasibility_score", "?"),
                result.get("feasibility_assessment", {}).get("recommendation", "?"),
            )
            return result

        except json.JSONDecodeError as exc:
            logger.error("Failed to parse AI response as JSON: %s", exc)
            return self._fallback_analysis(title, description)
        except Exception as exc:
            logger.error("AI analysis failed: %s", exc)
            return self._fallback_analysis(title, description)

    def _fallback_analysis(self, title: str, description: str | None) -> dict[str, Any]:
        """Rule-based fallback when AI is unavailable."""
        from src.utils.scorer import score_opportunity

        desc = description or ""
        score, breakdown = score_opportunity(
            title=title, description=desc, org_type=None,
            project_type=None, category=None, source_fit_score=70,
        )

        is_relevant = score >= 40
        return {
            "project_overview": f"Tender: {title}",
            "scope_of_work": desc[:500] if desc else "No description available",
            "scope_type": "unclear",
            "technical_requirements": {"materials": [], "measurements": "", "compliance": [], "specialized_needs": []},
            "qualification_requirements": {
                "experience_years": "not specified", "certifications": [],
                "insurance_min": "not specified", "labor_requirements": "",
                "bonding": "", "security_clearance": "", "other": [],
            },
            "critical_dates": {
                "posting_date": None, "closing_date": None, "site_visit_date": None,
                "pre_bid_meeting": None, "project_start": None, "project_completion": None,
                "timeline_notes": "",
            },
            "risk_factors": [],
            "window_covering_relevance": {
                "is_relevant": is_relevant,
                "relevance_explanation": breakdown.get("business_fit_explanation", ""),
                "specific_products": breakdown.get("primary_matches", []),
                "estimated_scope_percentage": min(score, 100),
            },
            "feasibility_assessment": {
                "feasibility_score": score,
                "recommendation": "review_carefully" if is_relevant else "skip",
                "business_fit_explanation": breakdown.get("business_fit_explanation", ""),
                "key_concerns": [],
                "key_advantages": breakdown.get("primary_matches", []),
            },
            "china_sourcing_analysis": {
                "viable": True, "explanation": "No restrictions identified (analysis unavailable)",
                "restrictions": [], "lead_time_concern": "Unknown",
            },
            "recommended_action": "Manual review recommended — AI analysis unavailable.",
            "analysis_model": "fallback_rule_based",
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }
