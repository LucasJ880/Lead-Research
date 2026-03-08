import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();

function fp(title: string, url: string): string {
  return crypto.createHash("sha256").update(title + url).digest("hex");
}

function sourceUrl(source: string, extId: string): string {
  if (source === "merx") return `https://merx.com/opportunities/${extId}`;
  if (source === "sam") return `https://sam.gov/opp/${extId}/view`;
  return `https://www.bidnetdirect.com/solicitations/${extId}`;
}

const TAGS: { name: string; category: string }[] = [
  { name: "window coverings", category: "product" },
  { name: "blinds", category: "product" },
  { name: "shades", category: "product" },
  { name: "curtains", category: "product" },
  { name: "drapery", category: "product" },
  { name: "renovation", category: "project_type" },
  { name: "construction", category: "project_type" },
  { name: "FF&E", category: "project_type" },
  { name: "school", category: "sector" },
  { name: "hospital", category: "sector" },
  { name: "government", category: "sector" },
  { name: "commercial", category: "sector" },
  { name: "residential", category: "sector" },
  { name: "hospitality", category: "sector" },
];

async function main() {
  console.log("Seeding database…\n");

  // ── 1. Admin user ───────────────────────────────────────
  const email = process.env.ADMIN_EMAIL ?? "admin@leadharvest.io";
  const rawPassword = process.env.ADMIN_PASSWORD ?? "changeme123";
  const passwordHash = await bcrypt.hash(rawPassword, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, name: "Admin", role: "admin" },
  });
  console.log(`  User: ${user.email} (${user.id})`);

  // ── 2. Tags ─────────────────────────────────────────────
  for (const tag of TAGS) {
    await prisma.tag.upsert({
      where: { name_category: { name: tag.name, category: tag.category } },
      update: {},
      create: tag,
    });
  }
  console.log(`  Tags: ${TAGS.length} upserted`);

  // ── 3. Sources ──────────────────────────────────────────
  const sourceDefs = [
    {
      name: "MERX Canadian Public Tenders",
      sourceType: "aggregator" as const,
      baseUrl: "https://www.merx.com",
      country: "CA",
      region: "National",
      frequency: "daily" as const,
      categoryTags: ["government", "construction", "education"],
      notes:
        "Primary Canadian aggregator covering federal, provincial, and municipal tenders.",
    },
    {
      name: "SAM.gov",
      sourceType: "bid_portal" as const,
      baseUrl: "https://sam.gov",
      country: "US",
      region: "National",
      frequency: "daily" as const,
      categoryTags: ["government", "federal"],
      notes:
        "US federal government System for Award Management. Primary source for federal contract opportunities.",
    },
    {
      name: "BidNet Direct",
      sourceType: "aggregator" as const,
      baseUrl: "https://www.bidnetdirect.com",
      country: "US",
      region: "National",
      frequency: "daily" as const,
      categoryTags: ["government", "education", "healthcare"],
      notes:
        "US state and local government bid aggregator with broad coverage.",
    },
  ];

  for (const src of sourceDefs) {
    const existing = await prisma.source.findFirst({
      where: { name: src.name },
    });
    if (!existing) {
      await prisma.source.create({ data: src });
    }
  }

  const merx = await prisma.source.findFirstOrThrow({
    where: { name: "MERX Canadian Public Tenders" },
  });
  const sam = await prisma.source.findFirstOrThrow({
    where: { name: "SAM.gov" },
  });
  const bidnet = await prisma.source.findFirstOrThrow({
    where: { name: "BidNet Direct" },
  });
  console.log("  Sources: 3 ready");

  // ── 4. Organizations ────────────────────────────────────
  const torontoOrg =
    (await prisma.organization.findFirst({
      where: {
        nameNormalized: "city of toronto",
        country: "CA",
        region: "ON",
      },
    })) ??
    (await prisma.organization.create({
      data: {
        name: "City of Toronto",
        nameNormalized: "city of toronto",
        orgType: "government",
        country: "CA",
        region: "ON",
        city: "Toronto",
        website: "https://www.toronto.ca",
      },
    }));

  const gsaOrg =
    (await prisma.organization.findFirst({
      where: {
        nameNormalized: "general services administration",
        country: "US",
        region: "DC",
      },
    })) ??
    (await prisma.organization.create({
      data: {
        name: "General Services Administration",
        nameNormalized: "general services administration",
        orgType: "government",
        country: "US",
        region: "DC",
        city: "Washington",
        website: "https://www.gsa.gov",
      },
    }));
  console.log("  Organizations: 2 upserted");

  // ── 5. Source Runs ──────────────────────────────────────
  let merxRun = await prisma.sourceRun.findFirst({
    where: { sourceId: merx.id },
    orderBy: { createdAt: "desc" },
  });
  if (!merxRun) {
    merxRun = await prisma.sourceRun.create({
      data: {
        sourceId: merx.id,
        status: "completed",
        startedAt: new Date("2026-03-07T02:00:00Z"),
        completedAt: new Date("2026-03-07T02:14:32Z"),
        durationMs: 872000,
        pagesCrawled: 45,
        opportunitiesFound: 28,
        opportunitiesCreated: 12,
        opportunitiesUpdated: 8,
        opportunitiesSkipped: 8,
        triggeredBy: "schedule",
        metadata: { version: "1.2.0", userAgent: "LeadHarvest-Crawler/1.2" },
      },
    });
  }

  let samRun = await prisma.sourceRun.findFirst({
    where: { sourceId: sam.id },
    orderBy: { createdAt: "desc" },
  });
  if (!samRun) {
    samRun = await prisma.sourceRun.create({
      data: {
        sourceId: sam.id,
        status: "completed",
        startedAt: new Date("2026-03-07T03:00:00Z"),
        completedAt: new Date("2026-03-07T03:08:15Z"),
        durationMs: 495000,
        pagesCrawled: 32,
        opportunitiesFound: 15,
        opportunitiesCreated: 5,
        opportunitiesUpdated: 6,
        opportunitiesSkipped: 4,
        triggeredBy: "schedule",
        metadata: { version: "1.2.0", userAgent: "LeadHarvest-Crawler/1.2" },
      },
    });
  }

  let bidnetRun = await prisma.sourceRun.findFirst({
    where: { sourceId: bidnet.id },
    orderBy: { createdAt: "desc" },
  });
  if (!bidnetRun) {
    bidnetRun = await prisma.sourceRun.create({
      data: {
        sourceId: bidnet.id,
        status: "completed",
        startedAt: new Date("2026-03-07T04:00:00Z"),
        completedAt: new Date("2026-03-07T04:11:47Z"),
        durationMs: 707000,
        pagesCrawled: 38,
        opportunitiesFound: 22,
        opportunitiesCreated: 8,
        opportunitiesUpdated: 9,
        opportunitiesSkipped: 5,
        triggeredBy: "schedule",
        metadata: { version: "1.2.0", userAgent: "LeadHarvest-Crawler/1.2" },
      },
    });
  }
  console.log("  Source runs: 3 ready");

  // ── 6. Opportunities (25) ──────────────────────────────
  const src = { merx: merx.id, sam: sam.id, bidnet: bidnet.id };
  const run = { merx: merxRun.id, sam: samRun.id, bidnet: bidnetRun.id };
  const org = { toronto: torontoOrg.id, gsa: gsaOrg.id };

  const opps = [
    // ── 1  (relevance 98) ─────────────────────────────────
    {
      source: "merx",
      orgKey: "toronto",
      externalId: "MERX-2026-0142",
      title:
        "Window Coverings Supply & Installation — City Hall Renovation",
      descriptionSummary:
        "Supply and installation of roller shades, motorized blinds, and solar shading systems for the City of Toronto City Hall renovation project.",
      descriptionFull: `The City of Toronto is seeking qualified suppliers for the procurement and installation of window coverings as part of the ongoing City Hall renovation project. The scope includes supply and installation of approximately 450 roller shades, 120 motorized blinds for executive offices and council chambers, and 85 solar shading systems for the atrium and public areas.

The project requires a combination of manual and motorized window covering systems compatible with the building's existing automation infrastructure. All products must meet or exceed CAN/ULC-S109 fire safety standards and carry a minimum 10-year warranty. Installation must be completed in phases to minimize disruption to ongoing municipal operations.

Vendors must demonstrate experience with large-scale institutional window covering projects and provide references for at least three comparable installations completed within the past five years. A mandatory site visit is scheduled for March 15, 2026. Submissions must include product samples, detailed project timelines, and a comprehensive maintenance plan.`,
      status: "open" as const,
      country: "CA",
      region: "ON",
      city: "Toronto",
      locationRaw: "Toronto, Ontario, Canada",
      postedDate: new Date("2026-02-15"),
      closingDate: new Date("2026-04-01T16:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      solicitationNumber: "TO-2026-PWS-0142",
      estimatedValue: 450000,
      currency: "CAD",
      contactName: "Jennifer Walsh",
      contactEmail: "j.walsh@toronto.ca",
      contactPhone: "416-392-7000",
      hasDocuments: true,
      mandatorySiteVisit: "2026-03-15 10:00 AM EST — Toronto City Hall, Main Lobby",
      addendaCount: 1,
      keywordsMatched: [
        "window coverings",
        "blinds",
        "shades",
        "roller shades",
        "motorized",
      ],
      relevanceScore: 98,
      relevanceBreakdown: {
        primary_matches: ["window coverings", "blinds", "shades"],
        secondary_matches: ["renovation", "government"],
        org_bonus: 10,
        final_score: 98,
      },
    },
    // ── 2  (relevance 95) ─────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0187",
      title: "Roller Shades & Motorized Blinds — Provincial Courthouse",
      descriptionSummary:
        "Supply and installation of roller shades and motorized blinds at the Provincial Courthouse in Ottawa, approximately 300 windows across four floors.",
      descriptionFull: `The Ontario Ministry of Government and Consumer Services is issuing this tender for the supply and installation of roller shades and motorized blinds at the Provincial Courthouse in Ottawa. The project encompasses approximately 300 windows across four floors of the courthouse building.

Requirements include heavy-duty roller shade systems with blackout capability for courtrooms, semi-transparent solar shades for administrative offices, and motorized blind systems for the main lobby and public galleries. All motorized systems must integrate with the building's centralized BMS (Building Management System) via dry contact relays.

Products must comply with Ontario Building Code requirements and all applicable fire safety standards. Preference will be given to vendors offering low-VOC, PVC-free fabric options. The anticipated project timeline is 16 weeks from contract award.`,
      status: "open" as const,
      country: "CA",
      region: "ON",
      city: "Ottawa",
      locationRaw: "Ottawa, Ontario, Canada",
      postedDate: new Date("2026-02-20"),
      closingDate: new Date("2026-04-10T16:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      solicitationNumber: "ON-MGCS-2026-0187",
      estimatedValue: 320000,
      currency: "CAD",
      hasDocuments: true,
      addendaCount: 2,
      keywordsMatched: [
        "roller shades",
        "motorized blinds",
        "blinds",
        "shades",
      ],
      relevanceScore: 95,
      relevanceBreakdown: {
        primary_matches: ["roller shades", "motorized blinds"],
        secondary_matches: ["government", "courthouse"],
        org_bonus: 5,
        final_score: 95,
      },
    },
    // ── 3  (relevance 93) ─────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0234",
      title:
        "Blackout Blinds & Solar Shades — Peel District School Board",
      descriptionSummary:
        "Supply and installation of blackout blinds and solar shades across 14 schools in the Peel District School Board, covering approximately 1,200 windows.",
      descriptionFull: `The Peel District School Board is seeking proposals for the supply and installation of blackout blinds and solar shades across 14 elementary and secondary schools in the Mississauga and Brampton areas. The total scope covers approximately 1,200 windows.

The project requires cordless or motorized blackout blinds for classrooms and presentation rooms to support modern audiovisual equipment, and solar shading systems for gymnasium and cafeteria spaces. All products must be child-safe, compliant with current CSA standards, and carry a minimum 5-year warranty.

Installation must be phased to align with school break periods. Priority installation is required for 6 schools during the spring break period (March 14–22, 2026), with remaining schools completed during the summer break. Vendors must provide a detailed phasing schedule with their submission.`,
      status: "open" as const,
      country: "CA",
      region: "ON",
      city: "Mississauga",
      locationRaw: "Mississauga / Brampton, Ontario, Canada",
      postedDate: new Date("2026-02-28"),
      closingDate: new Date("2026-04-12T16:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      solicitationNumber: "PDSB-PROC-2026-0234",
      estimatedValue: 275000,
      currency: "CAD",
      contactName: "Angela Diaz",
      contactEmail: "a.diaz@peelschools.org",
      hasDocuments: false,
      keywordsMatched: [
        "blinds",
        "blackout blinds",
        "solar shades",
        "shades",
        "school",
      ],
      relevanceScore: 93,
      relevanceBreakdown: {
        primary_matches: ["blinds", "blackout blinds", "solar shades"],
        secondary_matches: ["school", "education"],
        org_bonus: 5,
        final_score: 93,
      },
    },
    // ── 4  (relevance 92) ─────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0203",
      title: "Privacy Curtains — Hospital Wing Expansion",
      descriptionSummary:
        "Supply and installation of ceiling-mounted privacy curtain track systems with anti-microbial curtains for Hamilton General Hospital's new East Wing.",
      descriptionFull: `Hamilton Health Sciences is seeking qualified vendors for the supply and installation of privacy curtain systems for the new East Wing expansion at Hamilton General Hospital. The scope includes approximately 200 ceiling-mounted curtain track systems with anti-microbial privacy curtains for patient rooms, examination areas, and recovery bays.

All curtain fabrics must meet healthcare facility infection control standards, including anti-microbial treatment, flame resistance to CAN/ULC-S109, and machine-washable construction. Track systems must be ceiling-recessed, compatible with medical gas rail mounting, and capable of supporting curtain weights up to 3.5 kg/m.

The vendor must provide comprehensive installation services including track mounting, curtain hanging, and integration with existing nurse call systems. A 3-year fabric replacement program is also required as part of the contract.`,
      status: "open" as const,
      country: "CA",
      region: "ON",
      city: "Hamilton",
      locationRaw: "Hamilton, Ontario, Canada",
      postedDate: new Date("2026-02-25"),
      closingDate: new Date("2026-04-15T16:00:00Z"),
      category: "Window Coverings",
      projectType: "construction",
      solicitationNumber: "HHS-PROC-2026-0203",
      estimatedValue: 185000,
      currency: "CAD",
      contactName: "Mark Sullivan",
      contactEmail: "m.sullivan@hamiltonhealthsciences.ca",
      hasDocuments: false,
      keywordsMatched: ["curtains", "privacy curtains", "hospital"],
      relevanceScore: 92,
      relevanceBreakdown: {
        primary_matches: ["curtains", "privacy curtains"],
        secondary_matches: ["hospital", "healthcare"],
        org_bonus: 5,
        final_score: 92,
      },
    },
    // ── 5  (relevance 91) ─────────────────────────────────
    {
      source: "sam",
      externalId: "SAM-VA248-26-0156",
      title: "Vertical Blinds Replacement — VA Medical Center",
      descriptionSummary:
        "Replacement of vertical blinds across the Miami VA Medical Center main building and three adjacent clinic facilities, approximately 600 windows.",
      descriptionFull: `The Department of Veterans Affairs is soliciting proposals for the replacement of vertical blinds at the Miami VA Medical Center. The project covers approximately 600 windows across the main hospital building and three adjacent clinic facilities.

The scope of work includes removal and disposal of existing vertical blind systems, supply and installation of new commercial-grade vertical blinds with anti-microbial slats, and replacement of all mounting hardware. All products must comply with Buy American Act provisions and meet VA healthcare facility standards for infection control and fire safety.

The contractor must coordinate all work with hospital facility management to ensure zero disruption to patient care operations. Work is expected to be completed in phases over a 12-week period. Past performance on federal healthcare facility contracts is a key evaluation criterion.`,
      status: "open" as const,
      country: "US",
      region: "FL",
      city: "Miami",
      locationRaw: "Miami, FL, United States",
      postedDate: new Date("2026-03-05"),
      closingDate: new Date("2026-04-30T20:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      solicitationNumber: "VA-248-26-R-0156",
      estimatedValue: 95000,
      currency: "USD",
      contactName: "Patricia Morales",
      contactEmail: "patricia.morales@va.gov",
      contactPhone: "305-575-3000",
      hasDocuments: true,
      keywordsMatched: ["vertical blinds", "blinds", "replacement"],
      relevanceScore: 91,
      relevanceBreakdown: {
        primary_matches: ["vertical blinds", "blinds"],
        secondary_matches: ["hospital", "medical", "government"],
        org_bonus: 5,
        final_score: 91,
      },
    },
    // ── 6  (relevance 90) ─────────────────────────────────
    {
      source: "sam",
      orgKey: "gsa",
      externalId: "SAM-GS07F-26-0089",
      title: "Window Treatment Installation — Federal Office Building",
      descriptionSummary:
        "Installation of window treatments including blinds and shades at the GSA-managed Federal Office Building in Washington, DC.",
      status: "open" as const,
      country: "US",
      region: "DC",
      city: "Washington",
      locationRaw: "Washington, DC, United States",
      postedDate: new Date("2026-03-02"),
      closingDate: new Date("2026-04-25T20:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      solicitationNumber: "GS-07F-26-GA-0089",
      estimatedValue: 520000,
      currency: "USD",
      hasDocuments: true,
      keywordsMatched: [
        "window treatment",
        "blinds",
        "shades",
        "installation",
      ],
      relevanceScore: 90,
      relevanceBreakdown: {
        primary_matches: ["window treatment", "blinds", "shades"],
        secondary_matches: ["federal", "government"],
        org_bonus: 10,
        final_score: 90,
      },
    },
    // ── 7  (relevance 89) ─────────────────────────────────
    {
      source: "sam",
      externalId: "SAM-FA8903-26-0211",
      title: "Window Blinds & Accessories — Air Force Base Housing",
      descriptionSummary:
        "Supply and installation of window blinds and accessories for base housing units at Joint Base San Antonio, covering 280 residential units.",
      status: "open" as const,
      country: "US",
      region: "TX",
      city: "San Antonio",
      locationRaw: "San Antonio, TX, United States",
      postedDate: new Date("2026-03-03"),
      closingDate: new Date("2026-04-24T20:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      solicitationNumber: "FA8903-26-R-0211",
      estimatedValue: 165000,
      currency: "USD",
      hasDocuments: false,
      keywordsMatched: ["window blinds", "blinds", "accessories"],
      relevanceScore: 89,
      relevanceBreakdown: {
        primary_matches: ["window blinds", "blinds"],
        secondary_matches: ["military", "government", "housing"],
        org_bonus: 5,
        final_score: 89,
      },
    },
    // ── 8  (relevance 88) ─────────────────────────────────
    {
      source: "sam",
      orgKey: "gsa",
      externalId: "SAM-W52P1J-26-0034",
      title:
        "Interior Furnishings incl. Drapery — Embassy Suites Renovation",
      descriptionSummary:
        "Procurement of interior furnishings including custom drapery for the renovation of embassy suite buildings managed by GSA in Washington, DC.",
      status: "open" as const,
      country: "US",
      region: "DC",
      city: "Washington",
      locationRaw: "Washington, DC, United States",
      postedDate: new Date("2026-02-18"),
      closingDate: new Date("2026-04-05T20:00:00Z"),
      category: "FF&E",
      projectType: "renovation",
      solicitationNumber: "GS-11P-26-MKC-0034",
      estimatedValue: 750000,
      currency: "USD",
      contactName: "Robert Chen",
      contactEmail: "robert.chen@gsa.gov",
      hasDocuments: true,
      keywordsMatched: ["drapery", "furnishings", "interior"],
      relevanceScore: 88,
      relevanceBreakdown: {
        primary_matches: ["drapery"],
        secondary_matches: ["furnishings", "renovation", "government"],
        org_bonus: 5,
        final_score: 88,
      },
    },
    // ── 9  (relevance 87) ─────────────────────────────────
    {
      source: "bidnet",
      externalId: "BN-TX-2026-44521",
      title: "Custom Drapery — Governor's Mansion Restoration",
      descriptionSummary:
        "Fabrication and installation of custom drapery and window treatments for the Texas Governor's Mansion historical restoration project in Austin.",
      status: "open" as const,
      country: "US",
      region: "TX",
      city: "Austin",
      locationRaw: "Austin, TX, United States",
      postedDate: new Date("2026-03-01"),
      closingDate: new Date("2026-04-18T20:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      solicitationNumber: "TX-GOV-2026-44521",
      estimatedValue: 180000,
      currency: "USD",
      hasDocuments: false,
      keywordsMatched: ["drapery", "custom drapery", "curtains"],
      relevanceScore: 87,
      relevanceBreakdown: {
        primary_matches: ["drapery", "custom drapery"],
        secondary_matches: ["restoration", "government"],
        org_bonus: 5,
        final_score: 87,
      },
    },
    // ── 10  (relevance 86) ────────────────────────────────
    {
      source: "bidnet",
      externalId: "BN-CA-2026-43901",
      title: "Classroom Blinds Replacement — Sacramento Unified Schools",
      descriptionSummary:
        "Replacement of classroom blinds across 22 elementary schools in the Sacramento Unified School District.",
      status: "awarded" as const,
      country: "US",
      region: "CA",
      city: "Sacramento",
      locationRaw: "Sacramento, CA, United States",
      postedDate: new Date("2026-01-15"),
      closingDate: new Date("2026-02-28T21:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      solicitationNumber: "SUSD-FAC-2026-43901",
      estimatedValue: 98000,
      currency: "USD",
      hasDocuments: false,
      keywordsMatched: ["blinds", "replacement", "school"],
      relevanceScore: 86,
      relevanceBreakdown: {
        primary_matches: ["blinds"],
        secondary_matches: ["school", "education", "replacement"],
        org_bonus: 5,
        final_score: 86,
      },
    },
    // ── 11  (relevance 85) ────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0256",
      title: "FF&E Procurement — Boutique Hotel Renovation",
      descriptionSummary:
        "Full FF&E procurement including window coverings, drapery, and soft furnishings for the renovation of a boutique hotel in downtown Vancouver.",
      status: "open" as const,
      country: "CA",
      region: "BC",
      city: "Vancouver",
      locationRaw: "Vancouver, British Columbia, Canada",
      postedDate: new Date("2026-03-01"),
      closingDate: new Date("2026-04-20T16:00:00Z"),
      category: "FF&E",
      projectType: "renovation",
      estimatedValue: 1200000,
      currency: "CAD",
      hasDocuments: false,
      keywordsMatched: ["FF&E", "window coverings", "drapery", "hotel"],
      relevanceScore: 85,
      relevanceBreakdown: {
        primary_matches: ["window coverings", "drapery"],
        secondary_matches: ["FF&E", "hotel", "renovation"],
        org_bonus: 0,
        final_score: 85,
      },
    },
    // ── 12  (relevance 84) ────────────────────────────────
    {
      source: "bidnet",
      externalId: "BN-IL-2026-44678",
      title:
        "Curtains & Drapery Hardware — Performing Arts Center",
      descriptionSummary:
        "Supply of stage curtains, audience hall drapery, and associated hardware for the Chicago Civic Performing Arts Center renovation.",
      status: "open" as const,
      country: "US",
      region: "IL",
      city: "Chicago",
      locationRaw: "Chicago, IL, United States",
      postedDate: new Date("2026-02-24"),
      closingDate: new Date("2026-04-14T20:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      estimatedValue: 210000,
      currency: "USD",
      hasDocuments: false,
      keywordsMatched: ["curtains", "drapery", "hardware"],
      relevanceScore: 84,
      relevanceBreakdown: {
        primary_matches: ["curtains", "drapery"],
        secondary_matches: ["commercial", "performing arts"],
        org_bonus: 0,
        final_score: 84,
      },
    },
    // ── 13  (relevance 82) ────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0178",
      title:
        "Motorized Window Coverings — Calgary Convention Centre",
      descriptionSummary:
        "Supply and installation of motorized window covering systems for the Calgary Convention Centre expansion, including meeting rooms and exhibition halls.",
      status: "open" as const,
      country: "CA",
      region: "AB",
      city: "Calgary",
      locationRaw: "Calgary, Alberta, Canada",
      postedDate: new Date("2026-02-22"),
      closingDate: new Date("2026-04-08T16:00:00Z"),
      category: "Window Coverings",
      projectType: "construction",
      estimatedValue: 340000,
      currency: "CAD",
      hasDocuments: false,
      keywordsMatched: ["window coverings", "motorized", "blinds"],
      relevanceScore: 82,
      relevanceBreakdown: {
        primary_matches: ["window coverings", "motorized"],
        secondary_matches: ["commercial", "convention"],
        org_bonus: 0,
        final_score: 82,
      },
    },
    // ── 14  (relevance 80) ────────────────────────────────
    {
      source: "bidnet",
      externalId: "BN-CA-2026-45102",
      title:
        "Roller Shades — Los Angeles County Administrative Building",
      descriptionSummary:
        "Procurement and installation of roller shades for the Los Angeles County Hall of Administration, covering approximately 350 windows.",
      status: "open" as const,
      country: "US",
      region: "CA",
      city: "Los Angeles",
      locationRaw: "Los Angeles, CA, United States",
      postedDate: new Date("2026-03-04"),
      closingDate: new Date("2026-04-28T20:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      estimatedValue: 155000,
      currency: "USD",
      hasDocuments: false,
      keywordsMatched: ["roller shades", "shades", "window"],
      relevanceScore: 80,
      relevanceBreakdown: {
        primary_matches: ["roller shades", "shades"],
        secondary_matches: ["government", "county"],
        org_bonus: 5,
        final_score: 80,
      },
    },
    // ── 15  (relevance 78) ────────────────────────────────
    {
      source: "bidnet",
      externalId: "BN-NY-2026-44892",
      title:
        "Interior Renovation incl. Window Treatments — Public Library",
      descriptionSummary:
        "Full interior renovation of the New York Public Library Mid-Manhattan branch, including window treatments, lighting, and flooring.",
      status: "open" as const,
      country: "US",
      region: "NY",
      city: "New York",
      locationRaw: "New York, NY, United States",
      postedDate: new Date("2026-02-26"),
      closingDate: new Date("2026-04-22T20:00:00Z"),
      category: "Renovation",
      projectType: "renovation",
      estimatedValue: 890000,
      currency: "USD",
      hasDocuments: false,
      keywordsMatched: ["window treatments", "renovation", "interior"],
      relevanceScore: 78,
      relevanceBreakdown: {
        primary_matches: ["window treatments"],
        secondary_matches: ["renovation", "interior", "library"],
        org_bonus: 0,
        final_score: 78,
      },
    },
    // ── 16  (relevance 76) ────────────────────────────────
    {
      source: "bidnet",
      externalId: "BN-TX-2026-45001",
      title: "Solar Control Window Film & Shading Systems",
      descriptionSummary:
        "Installation of solar control window film and exterior shading systems for the Harris County Courthouse Annex in Houston.",
      status: "open" as const,
      country: "US",
      region: "TX",
      city: "Houston",
      locationRaw: "Houston, TX, United States",
      postedDate: new Date("2026-03-02"),
      closingDate: new Date("2026-04-20T20:00:00Z"),
      category: "Window Coverings",
      projectType: "renovation",
      estimatedValue: 135000,
      currency: "USD",
      hasDocuments: false,
      keywordsMatched: ["shading", "window", "solar"],
      relevanceScore: 76,
      relevanceBreakdown: {
        primary_matches: ["shading", "window"],
        secondary_matches: ["solar control", "government"],
        org_bonus: 0,
        final_score: 76,
      },
    },
    // ── 17  (relevance 72) ────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0289",
      title: "FF&E Supply — New Hospital Construction Phase 2",
      descriptionSummary:
        "FF&E supply for Phase 2 of the new CHUM hospital complex in Montreal, including furniture, curtains, blinds, and medical equipment furnishings.",
      status: "open" as const,
      country: "CA",
      region: "QC",
      city: "Montreal",
      locationRaw: "Montreal, Quebec, Canada",
      postedDate: new Date("2026-03-03"),
      closingDate: new Date("2026-05-01T16:00:00Z"),
      category: "FF&E",
      projectType: "construction",
      estimatedValue: 2500000,
      currency: "CAD",
      hasDocuments: false,
      keywordsMatched: ["FF&E", "curtains", "hospital"],
      relevanceScore: 72,
      relevanceBreakdown: {
        primary_matches: ["curtains"],
        secondary_matches: ["FF&E", "hospital", "construction"],
        org_bonus: 0,
        final_score: 72,
      },
    },
    // ── 18  (relevance 70) ────────────────────────────────
    {
      source: "bidnet",
      externalId: "BN-FL-2026-44823",
      title:
        "Furniture & Window Coverings — Senior Living Facility",
      descriptionSummary:
        "Procurement of furniture and window coverings for the Tampa Bay Senior Living expansion, 120 new assisted-living units.",
      status: "open" as const,
      country: "US",
      region: "FL",
      city: "Tampa",
      locationRaw: "Tampa, FL, United States",
      postedDate: new Date("2026-02-27"),
      closingDate: new Date("2026-04-16T20:00:00Z"),
      category: "FF&E",
      projectType: "construction",
      estimatedValue: 380000,
      currency: "USD",
      hasDocuments: false,
      keywordsMatched: ["window coverings", "furniture"],
      relevanceScore: 70,
      relevanceBreakdown: {
        primary_matches: ["window coverings"],
        secondary_matches: ["furniture", "senior living"],
        org_bonus: 0,
        final_score: 70,
      },
    },
    // ── 19  (relevance 65) ────────────────────────────────
    {
      source: "bidnet",
      externalId: "BN-NY-2026-45203",
      title: "Hospitality FF&E incl. Soft Window Treatments",
      descriptionSummary:
        "FF&E procurement including soft window treatments, upholstered furnishings, and decorative elements for the Buffalo Grand Hyatt renovation.",
      status: "open" as const,
      country: "US",
      region: "NY",
      city: "Buffalo",
      locationRaw: "Buffalo, NY, United States",
      postedDate: new Date("2026-03-05"),
      closingDate: new Date("2026-05-02T20:00:00Z"),
      category: "FF&E",
      projectType: "renovation",
      estimatedValue: 560000,
      currency: "USD",
      hasDocuments: false,
      keywordsMatched: ["window treatments", "FF&E", "hospitality"],
      relevanceScore: 65,
      relevanceBreakdown: {
        primary_matches: ["window treatments"],
        secondary_matches: ["FF&E", "hospitality"],
        org_bonus: 0,
        final_score: 65,
      },
    },
    // ── 20  (relevance 55) ────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0301",
      title: "Interior Finishing — Municipal Recreation Centre",
      descriptionSummary:
        "Interior finishing trades for the new Victoria Municipal Recreation Centre including flooring, painting, millwork, and window finishing.",
      status: "open" as const,
      country: "CA",
      region: "BC",
      city: "Victoria",
      locationRaw: "Victoria, British Columbia, Canada",
      postedDate: new Date("2026-03-06"),
      closingDate: new Date("2026-05-05T16:00:00Z"),
      category: "Interior Finishing",
      projectType: "construction",
      estimatedValue: 420000,
      currency: "CAD",
      hasDocuments: false,
      keywordsMatched: ["interior", "finishing"],
      relevanceScore: 55,
      relevanceBreakdown: {
        primary_matches: [],
        secondary_matches: ["interior", "finishing", "municipal"],
        org_bonus: 0,
        final_score: 55,
      },
    },
    // ── 21  (relevance 45) ────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0312",
      title: "Interior Design Services — Government Office Fit-Out",
      descriptionSummary:
        "Interior design consulting services for the fit-out of a new federal government office in Ottawa, including space planning and specifications.",
      status: "open" as const,
      country: "CA",
      region: "ON",
      city: "Ottawa",
      locationRaw: "Ottawa, Ontario, Canada",
      postedDate: new Date("2026-03-07"),
      closingDate: new Date("2026-05-10T16:00:00Z"),
      category: "Interior Finishing",
      projectType: "renovation",
      estimatedValue: 15000,
      currency: "CAD",
      hasDocuments: false,
      keywordsMatched: ["interior", "government", "office"],
      relevanceScore: 45,
      relevanceBreakdown: {
        primary_matches: [],
        secondary_matches: ["interior", "government", "office", "fit-out"],
        org_bonus: 5,
        final_score: 45,
      },
    },
    // ── 22  (relevance 35) ────────────────────────────────
    {
      source: "merx",
      orgKey: "toronto",
      externalId: "MERX-2026-0098",
      title: "General Construction — Office Tower Interior Renovation",
      descriptionSummary:
        "General contractor services for interior renovation of a 12-storey office tower in downtown Toronto, including demolition, framing, and finishing.",
      status: "open" as const,
      country: "CA",
      region: "ON",
      city: "Toronto",
      locationRaw: "Toronto, Ontario, Canada",
      postedDate: new Date("2026-02-10"),
      closingDate: new Date("2026-03-28T16:00:00Z"),
      category: "Construction",
      projectType: "construction",
      estimatedValue: 1800000,
      currency: "CAD",
      hasDocuments: false,
      keywordsMatched: ["renovation", "interior"],
      relevanceScore: 35,
      relevanceBreakdown: {
        primary_matches: [],
        secondary_matches: ["renovation", "interior", "construction"],
        org_bonus: 0,
        final_score: 35,
      },
    },
    // ── 23  (relevance 28) ────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0045",
      title: "Building Renovation — HVAC & Interior Upgrades",
      descriptionSummary:
        "Major building renovation including HVAC replacement, interior upgrades, and accessibility improvements at an Edmonton municipal facility.",
      status: "closed" as const,
      country: "CA",
      region: "AB",
      city: "Edmonton",
      locationRaw: "Edmonton, Alberta, Canada",
      postedDate: new Date("2026-02-01"),
      closingDate: new Date("2026-03-10T16:00:00Z"),
      category: "Renovation",
      projectType: "renovation",
      estimatedValue: 1500000,
      currency: "CAD",
      hasDocuments: false,
      keywordsMatched: ["renovation", "interior"],
      relevanceScore: 28,
      relevanceBreakdown: {
        primary_matches: [],
        secondary_matches: ["renovation", "interior"],
        org_bonus: 0,
        final_score: 28,
      },
    },
    // ── 24  (relevance 22) ────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0032",
      title: "Complete Building Renovation — Heritage Site",
      descriptionSummary:
        "Complete renovation of a heritage-designated building in Quebec City including structural, mechanical, electrical, and interior restoration.",
      status: "closed" as const,
      country: "CA",
      region: "QC",
      city: "Quebec City",
      locationRaw: "Quebec City, Quebec, Canada",
      postedDate: new Date("2026-01-28"),
      closingDate: new Date("2026-03-05T16:00:00Z"),
      category: "Construction",
      projectType: "renovation",
      estimatedValue: 2200000,
      currency: "CAD",
      hasDocuments: false,
      keywordsMatched: ["renovation"],
      relevanceScore: 22,
      relevanceBreakdown: {
        primary_matches: [],
        secondary_matches: ["renovation", "construction"],
        org_bonus: 0,
        final_score: 22,
      },
    },
    // ── 25  (relevance 15) ────────────────────────────────
    {
      source: "merx",
      externalId: "MERX-2026-0018",
      title: "Mechanical & Electrical Upgrades — Office Complex",
      descriptionSummary:
        "Mechanical and electrical system upgrades for a three-building office complex in Waterloo, including HVAC, lighting, and fire alarm replacement.",
      status: "closed" as const,
      country: "CA",
      region: "ON",
      city: "Waterloo",
      locationRaw: "Waterloo, Ontario, Canada",
      postedDate: new Date("2026-01-20"),
      closingDate: new Date("2026-03-01T16:00:00Z"),
      category: "Construction",
      projectType: "construction",
      estimatedValue: 980000,
      currency: "CAD",
      hasDocuments: false,
      keywordsMatched: ["office"],
      relevanceScore: 15,
      relevanceBreakdown: {
        primary_matches: [],
        secondary_matches: ["office"],
        org_bonus: 0,
        final_score: 15,
      },
    },
  ] as const;

  const createdOpps: { title: string; id: string }[] = [];

  for (const o of opps) {
    const url = sourceUrl(o.source, o.externalId);
    const hash = fp(o.title, url);

    const data: Parameters<typeof prisma.opportunity.create>[0]["data"] = {
      sourceId: src[o.source],
      sourceRunId: run[o.source],
      organizationId:
        "orgKey" in o && o.orgKey ? org[o.orgKey as keyof typeof org] : undefined,
      fingerprint: hash,
      externalId: o.externalId,
      title: o.title,
      descriptionSummary: o.descriptionSummary,
      descriptionFull:
        "descriptionFull" in o ? (o as any).descriptionFull : undefined,
      status: o.status,
      country: o.country,
      region: o.region,
      city: o.city,
      locationRaw: "locationRaw" in o ? (o as any).locationRaw : undefined,
      postedDate: o.postedDate,
      closingDate: o.closingDate,
      category: o.category,
      projectType: "projectType" in o ? (o as any).projectType : undefined,
      solicitationNumber:
        "solicitationNumber" in o ? (o as any).solicitationNumber : undefined,
      estimatedValue: o.estimatedValue,
      currency: o.currency,
      contactName:
        "contactName" in o ? (o as any).contactName : undefined,
      contactEmail:
        "contactEmail" in o ? (o as any).contactEmail : undefined,
      contactPhone:
        "contactPhone" in o ? (o as any).contactPhone : undefined,
      sourceUrl: url,
      hasDocuments: o.hasDocuments,
      mandatorySiteVisit:
        "mandatorySiteVisit" in o ? (o as any).mandatorySiteVisit : undefined,
      addendaCount: "addendaCount" in o ? (o as any).addendaCount : 0,
      keywordsMatched: o.keywordsMatched as unknown as string[],
      relevanceScore: o.relevanceScore,
      relevanceBreakdown: o.relevanceBreakdown,
    };

    const existing = await prisma.opportunity.findFirst({
      where: { fingerprint: hash },
    });
    if (existing) {
      createdOpps.push({ title: existing.title, id: existing.id });
    } else {
      const result = await prisma.opportunity.create({ data });
      createdOpps.push({ title: result.title, id: result.id });
    }
  }
  console.log(`  Opportunities: ${createdOpps.length} upserted`);

  // ── 7. Documents (5) ────────────────────────────────────
  const topOpp = createdOpps[0]; // score 98 — City Hall
  const opp2 = createdOpps[1]; // score 95 — Courthouse
  const opp5 = createdOpps[4]; // score 91 — VA Medical
  const opp6 = createdOpps[5]; // score 90 — Federal Office
  const opp8 = createdOpps[7]; // score 88 — Embassy Furnishings

  const docs = [
    {
      opportunityId: topOpp.id,
      title: "Tender Document — Window Coverings Supply TO-2026-PWS-0142.pdf",
      url: "https://merx.com/documents/MERX-2026-0142/tender-document.pdf",
      fileType: "pdf",
      fileSizeBytes: 2458624,
    },
    {
      opportunityId: topOpp.id,
      title: "Technical Specifications — Window Covering Systems.pdf",
      url: "https://merx.com/documents/MERX-2026-0142/technical-specs.pdf",
      fileType: "pdf",
      fileSizeBytes: 1843200,
    },
    {
      opportunityId: opp2.id,
      title: "RFP-2026-0187 Roller Shades & Motorized Blinds.pdf",
      url: "https://merx.com/documents/MERX-2026-0187/rfp-document.pdf",
      fileType: "pdf",
      fileSizeBytes: 3145728,
    },
    {
      opportunityId: opp8.id,
      title: "SOW — Interior Furnishings & Drapery.pdf",
      url: "https://sam.gov/documents/SAM-W52P1J-26-0034/sow.pdf",
      fileType: "pdf",
      fileSizeBytes: 1572864,
    },
    {
      opportunityId: opp6.id,
      title: "SF-1449 — Window Treatment Installation.pdf",
      url: "https://sam.gov/documents/SAM-GS07F-26-0089/sf1449.pdf",
      fileType: "pdf",
      fileSizeBytes: 2097152,
    },
  ];

  const existingDocCount = await prisma.opportunityDocument.count({
    where: {
      opportunityId: { in: [topOpp.id, opp2.id, opp5.id, opp6.id, opp8.id] },
    },
  });
  if (existingDocCount === 0) {
    for (const doc of docs) {
      await prisma.opportunityDocument.create({ data: doc });
    }
  }
  console.log("  Documents: 5 ready");

  // ── 8. Notes (2) on highest-relevance opportunity ───────
  const existingNoteCount = await prisma.note.count({
    where: { opportunityId: topOpp.id },
  });
  if (existingNoteCount === 0) {
    await prisma.note.create({
      data: {
        userId: user.id,
        opportunityId: topOpp.id,
        content:
          "High-priority opportunity. City Hall renovation is a large project with direct window covering scope — roller shades, motorized blinds, and solar shading. Need to prepare bid by April 1 deadline. Confirm product availability with Hunter Douglas rep.",
      },
    });
    await prisma.note.create({
      data: {
        userId: user.id,
        opportunityId: topOpp.id,
        content:
          "Confirmed with distributor — can meet the 12-week lead time for motorized roller shades. Budget allows for the Hunter Douglas Roller EcoScreen product line. Mandatory site visit on March 15; registered Jennifer Walsh as our contact.",
      },
    });
  }
  console.log("  Notes: 2 ready");

  // ── 9. Saved Search (1) ─────────────────────────────────
  const existingSearch = await prisma.savedSearch.findFirst({
    where: { userId: user.id, name: "Window Coverings - Ontario" },
  });
  if (!existingSearch) {
    await prisma.savedSearch.create({
      data: {
        userId: user.id,
        name: "Window Coverings - Ontario",
        filters: {
          keyword: "blinds shades curtains",
          country: "CA",
          regions: ["ON"],
          minRelevance: 50,
        },
        notifyEnabled: true,
        notifyFrequency: "daily",
        resultCount: 8,
      },
    });
  }
  console.log("  Saved search: 1 ready");

  console.log("\nSeed complete.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
