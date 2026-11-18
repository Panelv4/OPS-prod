import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  aiMessages,
  attendanceRecords,
  auditLogs,
  billingEvents,
  customerCommunications,
  customers,
  documents,
  documentVersions,
  employees,
  invoiceItems,
  invoices,
  leads,
  leaveRequests,
  notifications,
  payrollRuns,
  products,
  projects,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  taskComments,
  tasks,
  tenants,
  transactions,
  users,
  vendors,
  workflowExecutions,
  workflows,
  workspaceMembers,
} from "@/db/schema";
import { generateSecureToken, hashPassword } from "@/lib/security";
import {
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_ROLE_PERMISSIONS,
} from "@/lib/permissions";
import { calculatePayroll } from "@/lib/finance";

function isoDateOffset(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

function monthOffsetDate(monthsBack: number, day = 12): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsBack);
  d.setDate(Math.min(day, 26));
  return d.toISOString().slice(0, 10);
}

export async function ensureSeeded(): Promise<{
  seeded: boolean;
  tenantId: number;
}> {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.OPSPILOT_SEED_DEMO !== "1" ||
    !new URL(process.env.DATABASE_URL || "about:blank").pathname.endsWith(
      "_demo",
    )
  )
    throw new Error(
      "Use an explicitly enabled, disposable *_demo database only.",
    );
  const existing = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, "meridian-ops"))
    .limit(1);

  if (existing.length > 0) {
    return { seeded: false, tenantId: existing[0].id };
  }

  const demoPasswordHash = await hashPassword(generateSecureToken(32));

  // 1. Create Primary Demo Users (Meridian Digital & Commerce)
  const [ownerUser] = await db
    .insert(users)
    .values({
      email: "arjun@meridianstudio.in",
      passwordHash: demoPasswordHash,
      fullName: "Arjun Mehta",
      phone: "+91 98450 11204",
      emailVerified: true,
    })
    .returning();

  const [hrUser] = await db
    .insert(users)
    .values({
      email: "ananya@meridianstudio.in",
      passwordHash: demoPasswordHash,
      fullName: "Ananya Nair",
      phone: "+91 98450 22318",
      emailVerified: true,
    })
    .returning();

  const [salesUser] = await db
    .insert(users)
    .values({
      email: "rohan@meridianstudio.in",
      passwordHash: demoPasswordHash,
      fullName: "Rohan Kapoor",
      phone: "+91 98450 33901",
      emailVerified: true,
    })
    .returning();

  const [accountantUser] = await db
    .insert(users)
    .values({
      email: "kavya@meridianstudio.in",
      passwordHash: demoPasswordHash,
      fullName: "Kavya Iyer",
      phone: "+91 98450 44812",
      emailVerified: true,
    })
    .returning();

  const [employeeUser] = await db
    .insert(users)
    .values({
      email: "dev@meridianstudio.in",
      passwordHash: demoPasswordHash,
      fullName: "Dev Sharma",
      phone: "+91 98450 55920",
      emailVerified: true,
    })
    .returning();

  // Secondary Isolated Tenant Owner (Northstar Consulting Labs)
  const [secondOwner] = await db
    .insert(users)
    .values({
      email: "priya@northstarlabs.in",
      passwordHash: demoPasswordHash,
      fullName: "Priya Deshmukh",
      phone: "+91 98201 77410",
      emailVerified: true,
    })
    .returning();

  // 2. Create Tenants
  const [meridian] = await db
    .insert(tenants)
    .values({
      name: "Meridian Digital & Commerce",
      slug: "meridian-ops",
      industry: "Digital Agency & Workspace Hardware",
      currency: "INR",
      jurisdiction: "IN",
      taxLabel: "GST",
      defaultTaxBps: 1800,
      taxId: "29AABCM4821K1Z5",
      address:
        "14th Floor, Prestige Trade Tower, Palace Road, Bengaluru 560001",
      website: "https://meridianstudio.in",
      plan: "business",
      billingStatus: "active",
      aiProvider: "deterministic",
      aiModel: "opspilot-core-v1",
      aiTokensUsed: 12480,
      aiTokenLimit: 2500000,
      dashboardWidgets: DEFAULT_DASHBOARD_WIDGETS,
      rolePermissions: DEFAULT_ROLE_PERMISSIONS,
    })
    .returning();

  const [northstar] = await db
    .insert(tenants)
    .values({
      name: "Northstar Consulting Labs",
      slug: "northstar-labs",
      industry: "Strategy & Cloud Consulting",
      currency: "INR",
      jurisdiction: "IN",
      taxLabel: "GST",
      defaultTaxBps: 1800,
      taxId: "27AADCN9104M1Z2",
      address: "Bandra Kurla Complex, Mumbai 400051",
      plan: "pro",
      billingStatus: "active",
      aiProvider: "deterministic",
      aiModel: "opspilot-core-v1",
      aiTokenLimit: 500000,
      dashboardWidgets: DEFAULT_DASHBOARD_WIDGETS,
      rolePermissions: DEFAULT_ROLE_PERMISSIONS,
    })
    .returning();

  // 3. Memberships
  await db.insert(workspaceMembers).values([
    {
      tenantId: meridian.id,
      userId: ownerUser.id,
      role: "owner",
      title: "Founder & CEO",
    },
    {
      tenantId: meridian.id,
      userId: hrUser.id,
      role: "hr_manager",
      title: "Head of People",
    },
    {
      tenantId: meridian.id,
      userId: salesUser.id,
      role: "salesperson",
      title: "Account Executive",
    },
    {
      tenantId: meridian.id,
      userId: accountantUser.id,
      role: "accountant",
      title: "Finance Controller",
    },
    {
      tenantId: meridian.id,
      userId: employeeUser.id,
      role: "employee",
      title: "Product Engineer",
    },
    {
      tenantId: northstar.id,
      userId: secondOwner.id,
      role: "owner",
      title: "Managing Partner",
    },
  ]);

  const tId = meridian.id;

  // 4. CRM Customers
  const insertedCustomers = await db
    .insert(customers)
    .values([
      {
        tenantId: tId,
        name: "Vikramaditya Rao",
        company: "Veritas FinTech Pvt Ltd",
        email: "vikram@veritasfintech.in",
        phone: "+91 80 4120 8800",
        address: "Indiranagar, Bengaluru 560038",
        customerType: "enterprise",
        tags: ["Enterprise", "Retainer", "Priority"],
        notes:
          "Annual platform engineering retainer + 25 executive hardware kits.",
        assignedUserId: salesUser.id,
        assignedName: salesUser.fullName,
        totalSpentCents: 118000000, // ₹11,80,000
      },
      {
        tenantId: tId,
        name: "Meera Krishnan",
        company: "Kaveri Retail Brands",
        email: "meera@kaveriretail.com",
        phone: "+91 44 2815 4490",
        address: "Alwarpet, Chennai 600018",
        customerType: "business",
        tags: ["E-Commerce", "D2C", "Hardware"],
        notes: "Omnichannel storefront redesign and POS studio equipment.",
        assignedUserId: salesUser.id,
        assignedName: salesUser.fullName,
        totalSpentCents: 64900000, // ₹6,49,000
      },
      {
        tenantId: tId,
        name: "Siddharth Malhotra",
        company: "Aether Health Systems",
        email: "sid@aetherhealth.io",
        phone: "+91 22 6140 9920",
        address: "Lower Parel, Mumbai 400013",
        customerType: "enterprise",
        tags: ["Healthcare", "SaaS", "Expansion"],
        notes:
          "Q2 analytics portal launch; invoice INV-2026-003 follow-up due.",
        assignedUserId: ownerUser.id,
        assignedName: ownerUser.fullName,
        totalSpentCents: 47200000, // ₹4,72,000
      },
      {
        tenantId: tId,
        name: "Nisha Verma",
        company: "Solstice Architecture",
        email: "nisha@solsticearch.in",
        phone: "+91 11 4050 2219",
        address: "Hauz Khas, New Delhi 110016",
        customerType: "smb",
        tags: ["Design Studio", "Workstations"],
        notes: "Ordered Thunderbolt docks and ergonomic studio seating.",
        assignedUserId: salesUser.id,
        assignedName: salesUser.fullName,
        totalSpentCents: 29500000, // ₹2,95,000
      },
      {
        tenantId: tId,
        name: "Kabir Joshi",
        company: "Bluewave Logistics Tech",
        email: "kabir@bluewavelogistics.in",
        phone: "+91 20 6721 3340",
        address: "Baner, Pune 411045",
        customerType: "business",
        tags: ["Logistics", "Automation"],
        notes: "Evaluating annual ERP workflow consulting package.",
        assignedUserId: salesUser.id,
        assignedName: salesUser.fullName,
        totalSpentCents: 35400000, // ₹3,54,000
      },
    ])
    .returning();

  // Isolated customer for Northstar tenant
  await db.insert(customers).values({
    tenantId: northstar.id,
    name: "confidential Northstar Client",
    company: "Zenith Maritime Corp",
    email: "ops@zenithmaritime.in",
    customerType: "enterprise",
    tags: ["Maritime"],
    assignedUserId: secondOwner.id,
    assignedName: secondOwner.fullName,
    totalSpentCents: 50000000,
  });

  // Customer communications
  await db.insert(customerCommunications).values([
    {
      tenantId: tId,
      customerId: insertedCustomers[0].id,
      userId: salesUser.id,
      authorName: salesUser.fullName,
      channel: "meeting",
      subject: "Q2 Architecture & Hardware Expansion Review",
      content:
        "Confirmed Phase 2 milestone delivery and approved renewal terms for 12 months.",
    },
    {
      tenantId: tId,
      customerId: insertedCustomers[2].id,
      userId: accountantUser.id,
      authorName: accountantUser.fullName,
      channel: "email",
      subject: "Gentle reminder — INV-2026-003 settlement",
      content:
        "AP team confirmed NEFT payout scheduled following CFO approval this week.",
    },
  ]);

  // 5. CRM Leads across Pipeline Stages
  await db.insert(leads).values([
    {
      tenantId: tId,
      title: "Cloud Commerce Replatforming",
      contactName: "Aarav Kulkarni",
      company: "Vana Botanicals",
      email: "aarav@vanabotanicals.in",
      source: "Inbound Website",
      estimatedValueCents: 45000000,
      priority: "high",
      stage: "new",
      assignedUserId: salesUser.id,
      assignedName: salesUser.fullName,
      followUpDate: isoDateOffset(1),
      notes: "Looking for 8-week storefront migration + analytics dashboard.",
    },
    {
      tenantId: tId,
      title: "40-Seat Studio Hardware Refresh",
      contactName: "Rhea Chatterjee",
      company: "Pixelcraft Media",
      email: "rhea@pixelcraft.co",
      source: "Referral",
      estimatedValueCents: 82000000,
      priority: "urgent",
      stage: "qualified",
      assignedUserId: salesUser.id,
      assignedName: salesUser.fullName,
      followUpDate: isoDateOffset(2),
      notes:
        "Requested bulk quotation for Thunderbolt docks and ergonomic chairs.",
    },
    {
      tenantId: tId,
      customerId: insertedCustomers[4].id,
      title: "AI Supply-Chain Ops Retainer",
      contactName: "Kabir Joshi",
      company: "Bluewave Logistics Tech",
      email: "kabir@bluewavelogistics.in",
      source: "Existing Client",
      estimatedValueCents: 120000000,
      priority: "high",
      stage: "proposal",
      assignedUserId: ownerUser.id,
      assignedName: ownerUser.fullName,
      followUpDate: isoDateOffset(3),
      notes: "Proposal QTN-2026-001 shared with COO and VP Engineering.",
    },
    {
      tenantId: tId,
      title: "Annual Mobile App Maintenance",
      contactName: "Tanvi Shah",
      company: "Credence Wealth",
      email: "tanvi@credencewealth.in",
      source: "LinkedIn",
      estimatedValueCents: 68000000,
      priority: "medium",
      stage: "negotiation",
      assignedUserId: salesUser.id,
      assignedName: salesUser.fullName,
      followUpDate: isoDateOffset(1),
      notes: "Negotiating SLA response tiers and quarterly security audits.",
    },
    {
      tenantId: tId,
      title: "Brand Design Sprint",
      contactName: "Nikhil Bansal",
      company: "Orbit Robotics",
      email: "nikhil@orbitrobotics.in",
      source: "Conference",
      estimatedValueCents: 28000000,
      priority: "medium",
      stage: "contacted",
      assignedUserId: salesUser.id,
      assignedName: salesUser.fullName,
      followUpDate: isoDateOffset(5),
      notes: "Introductory discovery call completed.",
    },
    {
      tenantId: tId,
      customerId: insertedCustomers[0].id,
      title: "Veritas Annual Digital Platform",
      contactName: "Vikramaditya Rao",
      company: "Veritas FinTech Pvt Ltd",
      email: "vikram@veritasfintech.in",
      source: "Referral",
      estimatedValueCents: 118000000,
      priority: "high",
      stage: "won",
      assignedUserId: ownerUser.id,
      assignedName: ownerUser.fullName,
      followUpDate: isoDateOffset(-14),
      notes: "Signed and converted to active contract.",
    },
  ]);

  // 6. Vendors
  const insertedVendors = await db
    .insert(vendors)
    .values([
      {
        tenantId: tId,
        name: "Apex Precision Electronics",
        contactName: "Rajesh Menon",
        email: "supply@apexelectronics.in",
        phone: "+91 80 2678 1900",
        address: "Electronic City Phase 1, Bengaluru",
        category: "Hardware Manufacturing",
        taxId: "29AABCA7741D1Z1",
        paymentTerms: "Net 30",
        rating: 5,
        notes: "Primary OEM distributor for Thunderbolt docks and 4K displays.",
      },
      {
        tenantId: tId,
        name: "Forma Ergonomics India",
        contactName: "Deepika Reddy",
        email: "b2b@formaergo.in",
        phone: "+91 40 2311 8750",
        address: "HITEC City, Hyderabad",
        category: "Workspace Furniture",
        taxId: "36AABCF3390L1Z8",
        paymentTerms: "Net 15",
        rating: 4,
        notes: "Commercial seating and standing desk frames.",
      },
      {
        tenantId: tId,
        name: "Stratos Cloud Services",
        contactName: "Amitabh Sen",
        email: "billing@stratoscloud.io",
        phone: "+91 22 4890 1100",
        address: "Powai, Mumbai",
        category: "Cloud & Infrastructure",
        taxId: "27AADCS5520K1Z4",
        paymentTerms: "Due on Receipt",
        rating: 5,
        notes: "Managed Kubernetes, S3 backups, and enterprise CI runners.",
      },
    ])
    .returning();

  // 7. Inventory Products & Services
  const insertedProducts = await db
    .insert(products)
    .values([
      {
        tenantId: tId,
        vendorId: insertedVendors[0].id,
        sku: "HW-TB4-DOCK",
        name: "ProDock Thunderbolt 4 Hub",
        category: "Hardware",
        itemType: "product",
        description:
          "Anodized slate aluminum 16-port Thunderbolt 4 workstation dock with 96W PD.",
        imageUrl: "/images/products/workstation-dock.jpg",
        unit: "unit",
        purchasePriceCents: 1450000, // ₹14,500
        sellingPriceCents: 2200000, // ₹22,000
        taxRateBps: 1800,
        stockQuantity: 6, // LOW STOCK (reorderLevel: 12)
        reorderLevel: 12,
      },
      {
        tenantId: tId,
        vendorId: insertedVendors[1].id,
        sku: "FN-ERGO-PRO",
        name: "AeroMesh Executive Chair",
        category: "Furniture",
        itemType: "product",
        description:
          "BIFMA-certified charcoal mesh ergonomic task chair with 4D armrests.",
        imageUrl: "/images/products/ergonomic-chair.jpg",
        unit: "unit",
        purchasePriceCents: 1850000, // ₹18,500
        sellingPriceCents: 2950000, // ₹29,500
        taxRateBps: 1800,
        stockQuantity: 28,
        reorderLevel: 10,
      },
      {
        tenantId: tId,
        vendorId: insertedVendors[0].id,
        sku: "HW-USBC-MON",
        name: 'UltraSharp 27" 4K Studio Display',
        category: "Hardware",
        itemType: "product",
        description:
          "Color-calibrated IPS Black 4K USB-C studio monitor (99% DCI-P3).",
        unit: "unit",
        purchasePriceCents: 3100000,
        sellingPriceCents: 4400000,
        taxRateBps: 1800,
        stockQuantity: 4, // LOW STOCK (reorderLevel: 8)
        reorderLevel: 8,
      },
      {
        tenantId: tId,
        sku: "SV-ENG-RET",
        name: "Full-Stack Product Engineering Retainer",
        category: "Consulting",
        itemType: "service",
        description:
          "Dedicated pod of senior engineers & product designer (monthly sprint).",
        unit: "month",
        purchasePriceCents: 0,
        sellingPriceCents: 35000000, // ₹3,50,000
        taxRateBps: 1800,
        stockQuantity: 999,
        reorderLevel: 0,
      },
      {
        tenantId: tId,
        sku: "SV-AI-AUTO",
        name: "AI Workflow & ERP Implementation",
        category: "Consulting",
        itemType: "service",
        description:
          "End-to-end process audit, data migration, and custom automation deployment.",
        unit: "package",
        purchasePriceCents: 0,
        sellingPriceCents: 25000000, // ₹2,50,000
        taxRateBps: 1800,
        stockQuantity: 999,
        reorderLevel: 0,
      },
    ])
    .returning();

  await db.insert(stockMovements).values([
    {
      tenantId: tId,
      productId: insertedProducts[0].id,
      movementType: "purchase_receipt",
      quantityDelta: 20,
      previousStock: 0,
      newStock: 20,
      referenceType: "PO",
      referenceId: "PO-2026-001",
      reason: "Initial warehouse stock receipt from Apex Precision",
      actorName: ownerUser.fullName,
      createdByUserId: ownerUser.id,
    },
    {
      tenantId: tId,
      productId: insertedProducts[0].id,
      movementType: "sale",
      quantityDelta: -14,
      previousStock: 20,
      newStock: 6,
      referenceType: "INVOICE",
      referenceId: "INV-2026-002",
      reason: "Fulfilled client order for Kaveri Retail & Solstice",
      actorName: salesUser.fullName,
      createdByUserId: salesUser.id,
    },
    {
      tenantId: tId,
      productId: insertedProducts[1].id,
      movementType: "purchase_receipt",
      quantityDelta: 28,
      previousStock: 0,
      newStock: 28,
      referenceType: "PO",
      referenceId: "PO-2026-001",
      reason: "Received AeroMesh chair batch",
      actorName: ownerUser.fullName,
      createdByUserId: ownerUser.id,
    },
  ]);

  // 8. Purchase Orders
  const [po1, po2] = await db
    .insert(purchaseOrders)
    .values([
      {
        tenantId: tId,
        vendorId: insertedVendors[0].id,
        poNumber: "PO-2026-001",
        status: "paid",
        orderDate: monthOffsetDate(1, 5),
        expectedDate: monthOffsetDate(1, 14),
        receivedDate: monthOffsetDate(1, 13),
        vendorInvoiceNumber: "APX-88412",
        subtotalCents: 29000000,
        taxCents: 5220000,
        totalCents: 34220000,
        paidCents: 34220000,
        balanceCents: 0,
        approvedByName: ownerUser.fullName,
        createdByUserId: ownerUser.id,
      },
      {
        tenantId: tId,
        vendorId: insertedVendors[0].id,
        poNumber: "PO-2026-002",
        status: "pending_approval",
        orderDate: isoDateOffset(-2),
        expectedDate: isoDateOffset(9),
        subtotalCents: 37200000,
        taxCents: 6696000,
        totalCents: 43896000,
        paidCents: 0,
        balanceCents: 43896000,
        notes:
          "Restock 15 ProDock hubs & 5 UltraSharp 4K displays for Q2 demand.",
        createdByUserId: accountantUser.id,
      },
    ])
    .returning();

  await db.insert(purchaseOrderItems).values([
    {
      tenantId: tId,
      purchaseOrderId: po1.id,
      productId: insertedProducts[0].id,
      description: "ProDock Thunderbolt 4 Hub",
      quantity: 20,
      receivedQuantity: 20,
      unitCostCents: 1450000,
      taxRateBps: 1800,
      lineTotalCents: 34220000,
    },
    {
      tenantId: tId,
      purchaseOrderId: po2.id,
      productId: insertedProducts[0].id,
      description: "ProDock Thunderbolt 4 Hub (Restock)",
      quantity: 15,
      receivedQuantity: 0,
      unitCostCents: 1450000,
      taxRateBps: 1800,
      lineTotalCents: 25665000,
    },
    {
      tenantId: tId,
      purchaseOrderId: po2.id,
      productId: insertedProducts[2].id,
      description: 'UltraSharp 27" 4K Studio Display',
      quantity: 5,
      receivedQuantity: 0,
      unitCostCents: 3100000,
      taxRateBps: 1800,
      lineTotalCents: 18290000,
    },
  ]);

  // 9. Invoices, Sales Orders & Quotations
  const [inv1, inv2, inv3, inv4, qtn1] = await db
    .insert(invoices)
    .values([
      {
        tenantId: tId,
        customerId: insertedCustomers[0].id,
        docType: "invoice",
        invoiceNumber: "INV-2026-001",
        status: "paid",
        issueDate: monthOffsetDate(0, 2),
        dueDate: isoDateOffset(15),
        subtotalCents: 70000000,
        discountCents: 0,
        taxCents: 12600000,
        totalCents: 82600000, // ₹8,26,000
        paidCents: 82600000,
        refundedCents: 0,
        balanceCents: 0,
        currency: "INR",
        notes:
          "Thank you for your continued partnership with Meridian Digital.",
        createdByUserId: ownerUser.id,
      },
      {
        tenantId: tId,
        customerId: insertedCustomers[1].id,
        docType: "invoice",
        invoiceNumber: "INV-2026-002",
        status: "partial",
        issueDate: monthOffsetDate(0, 5),
        dueDate: isoDateOffset(10),
        subtotalCents: 47000000,
        discountCents: 0,
        taxCents: 8460000,
        totalCents: 55460000, // ₹5,54,600
        paidCents: 30000000,
        refundedCents: 0,
        balanceCents: 25460000, // ₹2,54,600
        currency: "INR",
        notes:
          "50%+ milestone received; remaining balance due on delivery sign-off.",
        createdByUserId: salesUser.id,
      },
      {
        tenantId: tId,
        customerId: insertedCustomers[2].id,
        docType: "invoice",
        invoiceNumber: "INV-2026-003",
        status: "overdue",
        issueDate: isoDateOffset(-28),
        dueDate: isoDateOffset(-9),
        subtotalCents: 35000000,
        discountCents: 0,
        taxCents: 6300000,
        totalCents: 41300000, // ₹4,13,000 overdue
        paidCents: 0,
        refundedCents: 0,
        balanceCents: 41300000,
        currency: "INR",
        reminderCount: 1,
        notes: "Analytics portal sprint invoice — Net 15 terms.",
        createdByUserId: accountantUser.id,
      },
      {
        tenantId: tId,
        customerId: insertedCustomers[3].id,
        docType: "sales_order",
        invoiceNumber: "SO-2026-001",
        status: "approved",
        issueDate: isoDateOffset(-3),
        dueDate: isoDateOffset(12),
        subtotalCents: 29500000,
        discountCents: 0,
        taxCents: 5310000,
        totalCents: 34810000,
        paidCents: 0,
        refundedCents: 0,
        balanceCents: 34810000,
        currency: "INR",
        notes:
          "10 AeroMesh Executive Chairs for New Delhi architecture studio.",
        createdByUserId: salesUser.id,
      },
      {
        tenantId: tId,
        customerId: insertedCustomers[4].id,
        docType: "quotation",
        invoiceNumber: "QTN-2026-001",
        status: "sent",
        issueDate: isoDateOffset(-4),
        dueDate: isoDateOffset(20),
        subtotalCents: 50000000,
        discountCents: 2500000,
        taxCents: 8550000,
        totalCents: 56050000,
        paidCents: 0,
        refundedCents: 0,
        balanceCents: 56050000,
        currency: "INR",
        notes:
          "Valid for 30 days. Includes 2 phases of AI Workflow Automation.",
        createdByUserId: ownerUser.id,
      },
    ])
    .returning();

  await db.insert(invoiceItems).values([
    {
      tenantId: tId,
      invoiceId: inv1.id,
      productId: insertedProducts[3].id,
      description: "Full-Stack Product Engineering Retainer (2 Pods)",
      quantity: 2,
      unitPriceCents: 35000000,
      discountCents: 0,
      taxRateBps: 1800,
      taxAmountCents: 12600000,
      lineTotalCents: 82600000,
    },
    {
      tenantId: tId,
      invoiceId: inv2.id,
      productId: insertedProducts[4].id,
      description: "AI Workflow & ERP Implementation",
      quantity: 1,
      unitPriceCents: 25000000,
      discountCents: 0,
      taxRateBps: 1800,
      taxAmountCents: 4500000,
      lineTotalCents: 29500000,
    },
    {
      tenantId: tId,
      invoiceId: inv2.id,
      productId: insertedProducts[0].id,
      description: "ProDock Thunderbolt 4 Hub",
      quantity: 10,
      unitPriceCents: 2200000,
      discountCents: 0,
      taxRateBps: 1800,
      taxAmountCents: 3960000,
      lineTotalCents: 25960000,
    },
    {
      tenantId: tId,
      invoiceId: inv3.id,
      productId: insertedProducts[3].id,
      description: "Analytics Portal Engineering Sprint",
      quantity: 1,
      unitPriceCents: 35000000,
      discountCents: 0,
      taxRateBps: 1800,
      taxAmountCents: 6300000,
      lineTotalCents: 41300000,
    },
    {
      tenantId: tId,
      invoiceId: inv4.id,
      productId: insertedProducts[1].id,
      description: "AeroMesh Executive Chair",
      quantity: 10,
      unitPriceCents: 2950000,
      discountCents: 0,
      taxRateBps: 1800,
      taxAmountCents: 5310000,
      lineTotalCents: 34810000,
    },
    {
      tenantId: tId,
      invoiceId: qtn1.id,
      productId: insertedProducts[4].id,
      description: "AI Workflow & ERP Implementation (2 Units)",
      quantity: 2,
      unitPriceCents: 25000000,
      discountCents: 2500000,
      taxRateBps: 1800,
      taxAmountCents: 8550000,
      lineTotalCents: 56050000,
    },
  ]);

  // 10. Six Months of Realistic Immutable Financial Ledger Transactions
  await db.insert(transactions).values([
    // 5 months ago
    {
      tenantId: tId,
      entryNumber: "TXN-2025-101",
      type: "income",
      direction: "credit",
      category: "Client Retainers",
      amountCents: 68000000,
      paymentMethod: "NEFT",
      transactionDate: monthOffsetDate(5, 10),
      description: "Retainer collection — Veritas & Solstice",
      customerId: insertedCustomers[0].id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2025-102",
      type: "payroll",
      direction: "debit",
      category: "Payroll & Benefits",
      amountCents: 36500000,
      paymentMethod: "Bank Transfer",
      transactionDate: monthOffsetDate(5, 25),
      description: "Monthly staff payroll disbursement",
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2025-103",
      type: "expense",
      direction: "debit",
      category: "Office & Rent",
      amountCents: 9500000,
      paymentMethod: "Bank Transfer",
      transactionDate: monthOffsetDate(5, 5),
      description: "Bengaluru studio lease & utilities",
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    // 4 months ago
    {
      tenantId: tId,
      entryNumber: "TXN-2025-104",
      type: "income",
      direction: "credit",
      category: "Client Retainers",
      amountCents: 79000000,
      paymentMethod: "RTGS",
      transactionDate: monthOffsetDate(4, 11),
      description: "Enterprise engineering & commerce delivery",
      customerId: insertedCustomers[1].id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2025-105",
      type: "payroll",
      direction: "debit",
      category: "Payroll & Benefits",
      amountCents: 38000000,
      paymentMethod: "Bank Transfer",
      transactionDate: monthOffsetDate(4, 25),
      description: "Monthly staff payroll disbursement",
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2025-106",
      type: "expense",
      direction: "debit",
      category: "Cloud & Software",
      amountCents: 8400000,
      paymentMethod: "Corporate Card",
      transactionDate: monthOffsetDate(4, 14),
      description: "Stratos Cloud hosting & developer tooling",
      vendorId: insertedVendors[2].id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    // 3 months ago
    {
      tenantId: tId,
      entryNumber: "TXN-2025-107",
      type: "income",
      direction: "credit",
      category: "Hardware Sales",
      amountCents: 91000000,
      paymentMethod: "RTGS",
      transactionDate: monthOffsetDate(3, 12),
      description: "Workspace hardware bundles & design sprint",
      customerId: insertedCustomers[3].id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2025-108",
      type: "payroll",
      direction: "debit",
      category: "Payroll & Benefits",
      amountCents: 39500000,
      paymentMethod: "Bank Transfer",
      transactionDate: monthOffsetDate(3, 25),
      description: "Monthly staff payroll disbursement",
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2025-109",
      type: "expense",
      direction: "debit",
      category: "Marketing & Ads",
      amountCents: 11200000,
      paymentMethod: "Corporate Card",
      transactionDate: monthOffsetDate(3, 18),
      description: "B2B demand generation & Bengaluru SaaS summit",
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    // 2 months ago
    {
      tenantId: tId,
      entryNumber: "TXN-2026-110",
      type: "income",
      direction: "credit",
      category: "Client Retainers",
      amountCents: 96500000,
      paymentMethod: "RTGS",
      transactionDate: monthOffsetDate(2, 9),
      description: "Quarterly retainer — Aether Health & Bluewave",
      customerId: insertedCustomers[2].id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2026-111",
      type: "payroll",
      direction: "debit",
      category: "Payroll & Benefits",
      amountCents: 41000000,
      paymentMethod: "Bank Transfer",
      transactionDate: monthOffsetDate(2, 25),
      description: "Monthly staff payroll disbursement",
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2026-112",
      type: "expense",
      direction: "debit",
      category: "Office & Rent",
      amountCents: 9500000,
      paymentMethod: "Bank Transfer",
      transactionDate: monthOffsetDate(2, 5),
      description: "Prestige Trade Tower office lease",
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    // 1 month ago
    {
      tenantId: tId,
      entryNumber: "TXN-2026-113",
      type: "income",
      direction: "credit",
      category: "Client Retainers",
      amountCents: 108000000,
      paymentMethod: "RTGS",
      transactionDate: monthOffsetDate(1, 8),
      description: "Platform delivery & studio workstation settlement",
      customerId: insertedCustomers[0].id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2026-114",
      type: "vendor_payment",
      direction: "debit",
      category: "Inventory Procurement",
      amountCents: 34220000,
      paymentMethod: "NEFT",
      transactionDate: monthOffsetDate(1, 16),
      description: "Settled PO-2026-001 (Apex Precision Electronics)",
      vendorId: insertedVendors[0].id,
      purchaseOrderId: po1.id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2026-115",
      type: "expense",
      direction: "debit",
      category: "Cloud & Software",
      amountCents: 8900000,
      paymentMethod: "Corporate Card",
      transactionDate: monthOffsetDate(1, 20),
      description: "Stratos Cloud production infrastructure",
      vendorId: insertedVendors[2].id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    // Current month
    {
      tenantId: tId,
      entryNumber: "TXN-2026-116",
      type: "income",
      direction: "credit",
      category: "Client Retainers",
      amountCents: 82600000,
      paymentMethod: "RTGS",
      transactionDate: monthOffsetDate(0, 3),
      description: "Payment received for INV-2026-001 (Veritas FinTech)",
      customerId: insertedCustomers[0].id,
      invoiceId: inv1.id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2026-117",
      type: "income",
      direction: "credit",
      category: "Hardware Sales",
      amountCents: 30000000,
      paymentMethod: "UPI / IMPS",
      transactionDate: monthOffsetDate(0, 6),
      description: "Partial payment received for INV-2026-002 (Kaveri Retail)",
      customerId: insertedCustomers[1].id,
      invoiceId: inv2.id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2026-118",
      type: "expense",
      direction: "debit",
      category: "Office & Rent",
      amountCents: 9500000,
      paymentMethod: "Bank Transfer",
      transactionDate: monthOffsetDate(0, 4),
      description: "Monthly studio rent & power backup",
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
    {
      tenantId: tId,
      entryNumber: "TXN-2026-119",
      type: "expense",
      direction: "debit",
      category: "Cloud & Software",
      amountCents: 7600000,
      paymentMethod: "Corporate Card",
      transactionDate: monthOffsetDate(0, 7),
      description: "Cloud cluster, observability & security scanners",
      vendorId: insertedVendors[2].id,
      actorName: accountantUser.fullName,
      createdByUserId: accountantUser.id,
    },
  ]);

  // 11. HRMS Employees, Attendance, Leave & Payroll
  const insertedEmployees = await db
    .insert(employees)
    .values([
      {
        tenantId: tId,
        userId: ownerUser.id,
        employeeCode: "EMP-001",
        fullName: "Arjun Mehta",
        email: "arjun@meridianstudio.in",
        phone: "+91 98450 11204",
        department: "Executive",
        designation: "Founder & CEO",
        joiningDate: "2022-04-01",
        employmentStatus: "active",
        jurisdiction: "IN",
        baseSalaryCents: 18000000,
        allowancesCents: 6000000,
        deductionsCents: 20000,
        taxRateBps: 1500,
        leaveBalanceAnnual: 16,
        leaveBalanceSick: 10,
        confidentialNotes:
          "Keyman insurance policy active; board compensation tier A.",
      },
      {
        tenantId: tId,
        userId: hrUser.id,
        employeeCode: "EMP-002",
        fullName: "Ananya Nair",
        email: "ananya@meridianstudio.in",
        phone: "+91 98450 22318",
        department: "People & HR",
        designation: "Head of People",
        joiningDate: "2022-09-12",
        employmentStatus: "active",
        managerName: "Arjun Mehta",
        jurisdiction: "IN",
        baseSalaryCents: 11000000,
        allowancesCents: 3500000,
        deductionsCents: 20000,
        taxRateBps: 1200,
        leaveBalanceAnnual: 14,
        leaveBalanceSick: 9,
        confidentialNotes: "Annual performance bonus approved at 12%.",
      },
      {
        tenantId: tId,
        userId: salesUser.id,
        employeeCode: "EMP-003",
        fullName: "Rohan Kapoor",
        email: "rohan@meridianstudio.in",
        phone: "+91 98450 33901",
        department: "Revenue & Sales",
        designation: "Senior Account Executive",
        joiningDate: "2023-02-15",
        employmentStatus: "active",
        managerName: "Arjun Mehta",
        jurisdiction: "IN",
        baseSalaryCents: 9500000,
        allowancesCents: 3200000,
        deductionsCents: 20000,
        taxRateBps: 1000,
        leaveBalanceAnnual: 12,
        leaveBalanceSick: 8,
        confidentialNotes:
          "3% quarterly commission accelerator on net-new ARR.",
      },
      {
        tenantId: tId,
        userId: accountantUser.id,
        employeeCode: "EMP-004",
        fullName: "Kavya Iyer",
        email: "kavya@meridianstudio.in",
        phone: "+91 98450 44812",
        department: "Finance",
        designation: "Finance Controller",
        joiningDate: "2023-05-08",
        employmentStatus: "active",
        managerName: "Arjun Mehta",
        jurisdiction: "IN",
        baseSalaryCents: 10500000,
        allowancesCents: 3000000,
        deductionsCents: 20000,
        taxRateBps: 1100,
        leaveBalanceAnnual: 15,
        leaveBalanceSick: 10,
        confidentialNotes:
          "Chartered Accountant — authorized bank signatory level 2.",
      },
      {
        tenantId: tId,
        userId: employeeUser.id,
        employeeCode: "EMP-005",
        fullName: "Dev Sharma",
        email: "dev@meridianstudio.in",
        phone: "+91 98450 55920",
        department: "Engineering",
        designation: "Staff Product Engineer",
        joiningDate: "2023-08-21",
        employmentStatus: "active",
        managerName: "Arjun Mehta",
        jurisdiction: "IN",
        baseSalaryCents: 12500000,
        allowancesCents: 4000000,
        deductionsCents: 20000,
        taxRateBps: 1200,
        leaveBalanceAnnual: 11,
        leaveBalanceSick: 7,
        confidentialNotes: "ESOP grant #14 vesting over 4 years.",
      },
      {
        tenantId: tId,
        employeeCode: "EMP-006",
        fullName: "Sana Mirza",
        email: "sana@meridianstudio.in",
        phone: "+91 98450 66109",
        department: "Design",
        designation: "Lead Product Designer",
        joiningDate: "2024-01-10",
        employmentStatus: "active",
        managerName: "Dev Sharma",
        jurisdiction: "IN",
        baseSalaryCents: 9800000,
        allowancesCents: 2800000,
        deductionsCents: 20000,
        taxRateBps: 1000,
        leaveBalanceAnnual: 17,
        leaveBalanceSick: 10,
        confidentialNotes: "High potential design leadership track.",
      },
    ])
    .returning();

  const today = isoDateOffset(0);
  await db.insert(attendanceRecords).values([
    {
      tenantId: tId,
      employeeId: insertedEmployees[0].id,
      date: today,
      checkInTime: "09:05",
      checkOutTime: "18:20",
      status: "present",
      workMinutes: 555,
    },
    {
      tenantId: tId,
      employeeId: insertedEmployees[1].id,
      date: today,
      checkInTime: "09:12",
      checkOutTime: "18:05",
      status: "present",
      workMinutes: 533,
    },
    {
      tenantId: tId,
      employeeId: insertedEmployees[2].id,
      date: today,
      checkInTime: "10:18",
      status: "late",
      workMinutes: 420,
      notes: "Client breakfast meeting in Indiranagar",
    },
    {
      tenantId: tId,
      employeeId: insertedEmployees[3].id,
      date: today,
      checkInTime: "09:00",
      checkOutTime: "17:55",
      status: "present",
      workMinutes: 535,
    },
    {
      tenantId: tId,
      employeeId: insertedEmployees[4].id,
      date: today,
      checkInTime: "09:30",
      status: "remote",
      workMinutes: 480,
      notes: "Working remotely on Veritas release",
    },
  ]);

  await db.insert(leaveRequests).values([
    {
      tenantId: tId,
      employeeId: insertedEmployees[4].id,
      leaveType: "annual",
      startDate: isoDateOffset(7),
      endDate: isoDateOffset(9),
      days: 3,
      reason: "Family wedding in Jaipur",
      status: "pending",
    },
    {
      tenantId: tId,
      employeeId: insertedEmployees[5].id,
      leaveType: "casual",
      startDate: isoDateOffset(-10),
      endDate: isoDateOffset(-9),
      days: 2,
      reason: "Personal travel",
      status: "approved",
      reviewerName: hrUser.fullName,
      reviewedAt: new Date(),
    },
  ]);

  // Seed last month's payroll runs
  const lastMonthPeriod = monthOffsetDate(1, 1).slice(0, 7);
  for (const emp of insertedEmployees.slice(0, 4)) {
    const calc = calculatePayroll({
      baseSalaryCents: emp.baseSalaryCents,
      allowancesCents: emp.allowancesCents,
      customDeductionsCents: emp.deductionsCents,
      taxRateBps: emp.taxRateBps,
      jurisdiction: emp.jurisdiction,
    });
    await db.insert(payrollRuns).values({
      tenantId: tId,
      employeeId: emp.id,
      period: lastMonthPeriod,
      jurisdiction: calc.jurisdiction,
      statutoryLabel: calc.statutoryLabel,
      baseSalaryCents: emp.baseSalaryCents,
      allowancesCents: emp.allowancesCents,
      statutoryDeductionCents: calc.statutoryDeductionCents,
      taxDeductionCents: calc.taxDeductionCents,
      netPayCents: calc.netPayCents,
      status: "paid",
      paidAt: new Date(),
    });
  }

  // 12. Projects & Tasks
  const [proj1, proj2, proj3] = await db
    .insert(projects)
    .values([
      {
        tenantId: tId,
        customerId: insertedCustomers[0].id,
        code: "PRJ-101",
        name: "Veritas Core Banking Portal v3",
        description:
          "Next-generation treasury dashboard, multi-currency reconciliation, and SSO rollout.",
        budgetCents: 120000000,
        spentCents: 74000000,
        status: "active",
        startDate: isoDateOffset(-45),
        deadline: isoDateOffset(25),
        teamMembers: ["Arjun Mehta", "Dev Sharma", "Sana Mirza"],
        ownerName: "Arjun Mehta",
      },
      {
        tenantId: tId,
        customerId: insertedCustomers[1].id,
        code: "PRJ-102",
        name: "Kaveri Omnichannel Storefront & POS",
        description:
          "Headless e-commerce experience plus flagship store workstation deployment.",
        budgetCents: 65000000,
        spentCents: 41000000,
        status: "active",
        startDate: isoDateOffset(-30),
        deadline: isoDateOffset(18),
        teamMembers: ["Dev Sharma", "Rohan Kapoor", "Sana Mirza"],
        ownerName: "Dev Sharma",
      },
      {
        tenantId: tId,
        customerId: insertedCustomers[2].id,
        code: "PRJ-103",
        name: "Aether Clinical Analytics Migration",
        description:
          "HIPAA/DISHA-aligned data warehouse migration and executive BI dashboards.",
        budgetCents: 50000000,
        spentCents: 46500000,
        status: "delayed",
        startDate: isoDateOffset(-60),
        deadline: isoDateOffset(-4),
        teamMembers: ["Dev Sharma", "Arjun Mehta"],
        ownerName: "Dev Sharma",
      },
    ])
    .returning();

  const insertedTasks = await db
    .insert(tasks)
    .values([
      {
        tenantId: tId,
        projectId: proj1.id,
        title: "Finalize multi-entity RBAC penetration test",
        description:
          "Verify role scoping on treasury approval endpoints before UAT sign-off.",
        assigneeUserId: employeeUser.id,
        assigneeName: "Dev Sharma",
        priority: "urgent",
        status: "in_progress",
        dueDate: isoDateOffset(3),
        createdByUserId: ownerUser.id,
      },
      {
        tenantId: tId,
        projectId: proj1.id,
        title: "Executive design review for reporting widgets",
        description:
          "Present dark and light mode design tokens to Veritas product lead.",
        assigneeName: "Sana Mirza",
        priority: "medium",
        status: "review",
        dueDate: isoDateOffset(5),
        createdByUserId: ownerUser.id,
      },
      {
        tenantId: tId,
        projectId: proj2.id,
        title: "Dispatch 10 ProDock Thunderbolt hubs to Chennai",
        description:
          "Coordinate courier manifest and serial number verification.",
        assigneeUserId: salesUser.id,
        assigneeName: "Rohan Kapoor",
        priority: "high",
        status: "todo",
        dueDate: isoDateOffset(2),
        createdByUserId: ownerUser.id,
      },
      {
        tenantId: tId,
        projectId: proj3.id,
        title: "Resolve legacy ETL schema mismatch on Aether pipeline",
        description:
          "Blocked on upstream table index verification — schedule sync with client DBA.",
        assigneeUserId: employeeUser.id,
        assigneeName: "Dev Sharma",
        priority: "urgent",
        status: "in_progress",
        dueDate: isoDateOffset(-2),
        createdByUserId: ownerUser.id,
      },
      {
        tenantId: tId,
        projectId: proj1.id,
        title: "Configure automated staging database backups",
        description:
          "Encrypted nightly pg_dump to S3-compatible bucket verified.",
        assigneeUserId: employeeUser.id,
        assigneeName: "Dev Sharma",
        priority: "medium",
        status: "done",
        dueDate: isoDateOffset(-6),
        createdByUserId: ownerUser.id,
      },
    ])
    .returning();

  await db.insert(taskComments).values([
    {
      tenantId: tId,
      taskId: insertedTasks[0].id,
      userId: employeeUser.id,
      authorName: "Dev Sharma",
      content:
        "Completed 18/20 security test scenarios. Zero cross-tenant leaks found.",
    },
  ]);

  // 13. Documents & Version History
  const msaText =
    "MASTER SERVICES AGREEMENT — Meridian Digital & Commerce and Veritas FinTech Pvt Ltd.\nEffective Date: 2026-01-01 | Annual Value: INR 1,18,00,000 | Payment Terms: Net 15 | Confidentiality & IP Assignment clauses active.";
  const policyText =
    "MERIDIAN PEOPLE & LEAVE HANDBOOK v2.0 (2026)\nAnnual Leave: 18 days | Sick Leave: 10 days | Hybrid Work Policy: Tue-Thu in Bengaluru studio | Payroll processed on 28th of every month.";
  const vendorCertText =
    "APEX PRECISION ELECTRONICS — ISO 9001 & GST COMPLIANCE CERTIFICATE\nVendor Tax ID: 29AABCA7741D1Z1 | Renewal required prior to expiration date.";

  const [doc1, doc2, doc3] = await db
    .insert(documents)
    .values([
      {
        tenantId: tId,
        title: "Veritas FinTech — Master Services Agreement",
        fileName: "veritas-msa-2026.txt",
        mimeType: "text/plain",
        sizeBytes: Buffer.byteLength(msaText),
        category: "contract",
        visibility: "managers",
        currentVersion: 2,
        contentBase64: Buffer.from(msaText).toString("base64"),
        textPreview: msaText,
        expiresAt: isoDateOffset(240),
        uploadedByUserId: ownerUser.id,
        uploaderName: ownerUser.fullName,
      },
      {
        tenantId: tId,
        title: "Employee Handbook & Leave Policy 2026",
        fileName: "employee-handbook-2026.txt",
        mimeType: "text/plain",
        sizeBytes: Buffer.byteLength(policyText),
        category: "policy",
        visibility: "workspace",
        currentVersion: 1,
        contentBase64: Buffer.from(policyText).toString("base64"),
        textPreview: policyText,
        uploadedByUserId: hrUser.id,
        uploaderName: hrUser.fullName,
      },
      {
        tenantId: tId,
        title: "Apex Electronics Vendor Compliance Certificate",
        fileName: "apex-gst-compliance.txt",
        mimeType: "text/plain",
        sizeBytes: Buffer.byteLength(vendorCertText),
        category: "finance",
        visibility: "finance_only",
        currentVersion: 1,
        contentBase64: Buffer.from(vendorCertText).toString("base64"),
        textPreview: vendorCertText,
        expiresAt: isoDateOffset(14), // Expiring soon reminder!
        uploadedByUserId: accountantUser.id,
        uploaderName: accountantUser.fullName,
      },
    ])
    .returning();

  await db.insert(documentVersions).values([
    {
      tenantId: tId,
      documentId: doc1.id,
      versionNumber: 1,
      fileName: "veritas-msa-draft.txt",
      mimeType: "text/plain",
      sizeBytes: 160,
      contentBase64: Buffer.from("Initial legal redline draft v1.").toString(
        "base64",
      ),
      changeNote: "Initial legal draft uploaded",
      uploaderName: ownerUser.fullName,
    },
    {
      tenantId: tId,
      documentId: doc1.id,
      versionNumber: 2,
      fileName: "veritas-msa-2026.txt",
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(msaText),
      contentBase64: Buffer.from(msaText).toString("base64"),
      changeNote: "Countersigned final agreement with Net 15 addendum",
      uploaderName: ownerUser.fullName,
    },
    {
      tenantId: tId,
      documentId: doc2.id,
      versionNumber: 1,
      fileName: "employee-handbook-2026.txt",
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(policyText),
      contentBase64: Buffer.from(policyText).toString("base64"),
      changeNote: "Published FY26 policy",
      uploaderName: hrUser.fullName,
    },
    {
      tenantId: tId,
      documentId: doc3.id,
      versionNumber: 1,
      fileName: "apex-gst-compliance.txt",
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(vendorCertText),
      contentBase64: Buffer.from(vendorCertText).toString("base64"),
      changeNote: "Uploaded supplier tax certificate",
      uploaderName: accountantUser.fullName,
    },
  ]);

  // 14. Workflow Automations + Execution Log
  const [wf1, wf2, wf3] = await db
    .insert(workflows)
    .values([
      {
        tenantId: tId,
        name: "New Lead Instant Sales Alert",
        description:
          "Notify assigned salesperson and log audit event whenever a new CRM lead arrives.",
        triggerEvent: "lead.created",
        conditions: [],
        actions: [
          {
            type: "notify",
            targetRole: "salesperson",
            title: "New Lead Assigned: {{title}}",
            message:
              "{{company}} submitted lead '{{title}}' (assigned to {{assignedName}}).",
          },
          {
            type: "log_audit",
            message: "Auto-routed new lead '{{title}}' for {{company}}.",
          },
        ],
        approvalStatus: "approved",
        approvedByName: ownerUser.fullName,
        isEnabled: true,
        retryLimit: 2,
        runCount: 4,
        lastRunAt: new Date(),
        createdByUserId: ownerUser.id,
      },
      {
        tenantId: tId,
        name: "Overdue Invoice Collection Reminder",
        description:
          "Create payment reminder and notify finance when an invoice becomes overdue.",
        triggerEvent: "invoice.overdue",
        conditions: [],
        actions: [
          {
            type: "send_invoice_reminder",
            title: "Overdue Payment: {{invoiceNumber}}",
            message:
              "Invoice {{invoiceNumber}} passed due date {{dueDate}}. Reminder dispatched.",
          },
        ],
        approvalStatus: "approved",
        approvedByName: ownerUser.fullName,
        isEnabled: true,
        retryLimit: 3,
        runCount: 1,
        lastRunAt: new Date(),
        createdByUserId: ownerUser.id,
      },
      {
        tenantId: tId,
        name: "Low-Stock Threshold Inventory Alert",
        description:
          "Notify inventory manager and create restock task when SKU falls below threshold.",
        triggerEvent: "stock.low",
        conditions: [],
        actions: [
          {
            type: "notify",
            targetRole: "manager",
            title: "Low Stock Alert: {{name}}",
            message:
              "SKU {{sku}} dropped to {{stockQuantity}} units (threshold: {{reorderLevel}}).",
          },
        ],
        approvalStatus: "approved",
        approvedByName: ownerUser.fullName,
        isEnabled: true,
        retryLimit: 2,
        runCount: 2,
        lastRunAt: new Date(),
        createdByUserId: ownerUser.id,
      },
      {
        tenantId: tId,
        name: "Leave Request HR Notification",
        description:
          "Notify HR Manager immediately when an employee applies for leave.",
        triggerEvent: "leave.requested",
        conditions: [],
        actions: [
          {
            type: "notify",
            targetRole: "hr_manager",
            title: "Leave Requested: {{employeeName}}",
            message:
              "{{employeeName}} requested {{days}} day(s) of {{leaveType}} leave.",
          },
        ],
        approvalStatus: "approved",
        approvedByName: ownerUser.fullName,
        isEnabled: true,
        retryLimit: 2,
        runCount: 1,
        lastRunAt: new Date(),
        createdByUserId: hrUser.id,
      },
      {
        tenantId: tId,
        name: "Overdue Task Escalation Draft",
        description:
          "AI-generated workflow: Wait 30 minutes and notify assignee when task becomes overdue.",
        triggerEvent: "task.overdue",
        conditions: [],
        actions: [
          { type: "delay", delayMinutes: 30 },
          {
            type: "notify",
            targetRole: "employee",
            title: "Overdue Task: {{title}}",
            message:
              "Task '{{title}}' assigned to {{assignedName}} was due on {{dueDate}}.",
          },
        ],
        approvalStatus: "pending_approval",
        isEnabled: false,
        generatedByAi: true,
        retryLimit: 2,
        runCount: 0,
        createdByUserId: ownerUser.id,
      },
    ])
    .returning();

  await db.insert(workflowExecutions).values([
    {
      tenantId: tId,
      workflowId: wf1.id,
      workflowName: wf1.name,
      triggerEvent: "lead.created",
      status: "completed",
      attemptCount: 1,
      triggerPayload: {
        title: "40-Seat Studio Hardware Refresh",
        company: "Pixelcraft Media",
      },
      stepLogs: [
        {
          step: "Step 1: notify",
          status: "completed",
          detail: "Sent in-app notification to salesperson Rohan Kapoor",
          at: new Date().toISOString(),
        },
        {
          step: "Step 2: log_audit",
          status: "completed",
          detail: "Recorded audit entry",
          at: new Date().toISOString(),
        },
      ],
      completedAt: new Date(),
    },
    {
      tenantId: tId,
      workflowId: wf2.id,
      workflowName: wf2.name,
      triggerEvent: "invoice.overdue",
      status: "completed",
      attemptCount: 1,
      triggerPayload: { invoiceNumber: "INV-2026-003", balanceCents: 41300000 },
      stepLogs: [
        {
          step: "Step 1: send_invoice_reminder",
          status: "completed",
          detail: "Dispatched payment reminder for INV-2026-003",
          at: new Date().toISOString(),
        },
      ],
      completedAt: new Date(),
    },
    {
      tenantId: tId,
      workflowId: wf3.id,
      workflowName: wf3.name,
      triggerEvent: "stock.low",
      status: "completed",
      attemptCount: 1,
      triggerPayload: {
        sku: "HW-TB4-DOCK",
        stockQuantity: 6,
        reorderLevel: 12,
      },
      stepLogs: [
        {
          step: "Step 1: notify",
          status: "completed",
          detail: "Alerted inventory manager on HW-TB4-DOCK (6/12 units)",
          at: new Date().toISOString(),
        },
      ],
      completedAt: new Date(),
    },
  ]);

  // 15. Notifications, AI Welcome Message, Billing Event & Audit Logs
  await db.insert(notifications).values([
    {
      tenantId: tId,
      title: "Overdue Invoice INV-2026-003",
      message: "Aether Health Systems has ₹4,13,000 overdue by 9 days.",
      type: "warning",
      link: "/app/sales",
      isRead: false,
    },
    {
      tenantId: tId,
      title: "Low Stock: ProDock Thunderbolt 4 Hub",
      message:
        "Only 6 units left in inventory (reorder level: 12). PO-2026-002 awaits approval.",
      type: "alert",
      link: "/app/inventory",
      isRead: false,
    },
    {
      tenantId: tId,
      title: "Leave Approval Pending",
      message: "Dev Sharma requested 3 days of annual leave for family travel.",
      type: "info",
      link: "/app/hrms",
      isRead: false,
    },
    {
      tenantId: tId,
      title: "AI Workflow Ready for Approval",
      message:
        "'Overdue Task Escalation Draft' awaits manager sign-off before activation.",
      type: "automation",
      link: "/app/automations",
      isRead: true,
    },
  ]);

  await db.insert(aiMessages).values([
    {
      tenantId: tId,
      userId: ownerUser.id,
      role: "assistant",
      content:
        "Welcome to **OpsPilot Intelligence** for **Meridian Digital & Commerce**. Every answer I generate is computed directly from your live, permission-scoped PostgreSQL records — never fabricated.\n\nAsk me about this month's revenue, overdue invoices, largest expenses, low-stock SKUs, delayed projects, anomaly detection, receipt extraction, or describe a workflow to automate.",
      toolsUsed: ["workspace_context_init"],
      tokensUsed: 0,
      provider: "deterministic:opspilot-core-v1",
    },
  ]);

  await db.insert(billingEvents).values([
    {
      tenantId: tId,
      previousPlan: "pro",
      newPlan: "business",
      amountInr: 1499,
      description:
        "Upgraded Meridian Digital & Commerce to Business Plan (₹1,499/month)",
      actorName: ownerUser.fullName,
    },
  ]);

  await db.insert(auditLogs).values([
    {
      tenantId: tId,
      userId: ownerUser.id,
      actorName: ownerUser.fullName,
      action: "invoice.paid",
      module: "sales",
      entityType: "invoice",
      entityId: String(inv1.id),
      summary:
        "Recorded full payment of ₹8,26,000 on INV-2026-001 (Veritas FinTech)",
    },
    {
      tenantId: tId,
      userId: salesUser.id,
      actorName: salesUser.fullName,
      action: "lead.created",
      module: "crm",
      entityType: "lead",
      summary:
        "Added qualified opportunity '40-Seat Studio Hardware Refresh' (₹8,20,000)",
    },
    {
      tenantId: tId,
      userId: accountantUser.id,
      actorName: accountantUser.fullName,
      action: "po.created",
      module: "procurement",
      entityType: "purchase_order",
      entityId: String(po2.id),
      summary:
        "Submitted PO-2026-002 (₹4,38,960) to Apex Precision for approval",
    },
    {
      tenantId: tId,
      userId: hrUser.id,
      actorName: hrUser.fullName,
      action: "payroll.disbursed",
      module: "hrms",
      entityType: "payroll",
      summary: `Completed IN jurisdiction payroll run for period ${lastMonthPeriod}`,
    },
  ]);

  return { seeded: true, tenantId: tId };
}

// Allow running directly via `npx tsx src/db/seed.ts`
if (require.main === module) {
  ensureSeeded()
    .then((res) => {
      console.log("OpsPilot seed status:", res);
      process.exit(0);
    })
    .catch((err) => {
      console.error(
        "Demo seed refused or failed; check the disposable database configuration.",
      );
      process.exit(1);
    });
}
