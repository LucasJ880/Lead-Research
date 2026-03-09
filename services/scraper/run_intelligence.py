"""CLI runner for the MERX intelligence pipeline.

Usage:
    # Analyze a single opportunity by ID
    python run_intelligence.py --id <uuid>

    # Analyze a batch of unanalyzed MERX opportunities
    python run_intelligence.py --batch --limit 5 --min-relevance 40

    # Analyze all highly relevant MERX opportunities
    python run_intelligence.py --batch --limit 20 --min-relevance 60
"""

from __future__ import annotations

import argparse
import json
import sys

from src.core.database import get_db
from src.core.logging import get_logger
from src.intelligence.merx_pipeline import MerxIntelligencePipeline

logger = get_logger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="MERX Intelligence Pipeline")
    parser.add_argument("--id", help="Analyze a single opportunity by UUID")
    parser.add_argument("--batch", action="store_true", help="Analyze a batch of unanalyzed opportunities")
    parser.add_argument("--limit", type=int, default=5, help="Max opportunities for batch mode")
    parser.add_argument("--min-relevance", type=int, default=40, help="Min relevance score for batch")
    parser.add_argument("--source", default="MERX", help="Source name filter for batch")
    args = parser.parse_args()

    if not args.id and not args.batch:
        parser.print_help()
        sys.exit(1)

    with get_db() as db:
        pipeline = MerxIntelligencePipeline(db)

        if args.id:
            logger.info("Analyzing single opportunity: %s", args.id)
            result = pipeline.analyze_opportunity(args.id)
            print(json.dumps(result, indent=2, default=str))

        elif args.batch:
            logger.info(
                "Batch analysis: limit=%d, min_relevance=%d, source=%s",
                args.limit, args.min_relevance, args.source,
            )
            results = pipeline.analyze_batch(
                limit=args.limit,
                min_relevance=args.min_relevance,
                source_name=args.source,
            )
            print(json.dumps(results, indent=2, default=str))
            print(f"\nCompleted: {sum(1 for r in results if 'error' not in r)}/{len(results)}")


if __name__ == "__main__":
    main()
