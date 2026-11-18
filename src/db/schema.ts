import {
  pgTable,
  serial,
  integer,
  bigint,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";

// ============================================================================
// 1. IDENTITY, AUTHENTICATION & MULTI-TENANT WORKSPACES
// ============================================================================

export interface NotificationPrefs {
  inApp: boolean;
  email: boolean;
  invoiceAlerts: boolean;
  leadAlerts: boolean;
  stockAlerts: boolean;
  hrAlerts: boolean;
  taskAlerts: boolean;
  automationAlerts: boolean;
}

export interface DashboardWidgetConfig {
  id: string;
  label: string;
  visible: boolean;
  order: number;
}

export type WorkspaceRole =
  | "owner"
  | "administrator"
  | "manager"
  | "hr_manager"
  | "accountant"
  | "salesperson"
  | "employee";

export type PlanTier = "community" | "starter" | "pro" | "business" | "custom";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
    emailVerified: boolean("email_verified").notNull().default(false),
    verificationTokenHash: text("verification_token_hash"),
    verificationExpiresAt: timestamp("verification_expires_at"),
    resetTokenHash: text("reset_token_hash"),
    resetTokenExpiresAt: timestamp("reset_token_expires_at"),
    notificationPrefs: jsonb("notification_prefs")
      .$type<NotificationPrefs>()
      .notNull()
      .default({
        inApp: true,
        email: false,
        invoiceAlerts: true,
        leadAlerts: true,
        stockAlerts: true,
        hrAlerts: true,
        taskAlerts: true,
        automationAlerts: true,
      }),
    lastLoginAt: timestamp("last_login_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const tenants = pgTable(
  "tenants",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    industry: text("industry").notNull().default("Technology & Services"),
    currency: text("currency").notNull().default("INR"),
    jurisdiction: text("jurisdiction").notNull().default("IN"),
    taxLabel: text("tax_label").notNull().default("GST"),
    defaultTaxBps: integer("default_tax_bps").notNull().default(1800),
    taxId: text("tax_id"),
    address: text("address"),
    website: text("website"),
    plan: text("plan").$type<PlanTier>().notNull().default("community"),
    billingStatus: text("billing_status").notNull().default("active"),
    customPriceInr: integer("custom_price_inr"),
    planConfig: jsonb("plan_config")
      .$type<
        Record<
          string,
          {
            priceInr: number;
            label: string;
            period: string;
            aiTokenLimit: number;
            maxUsers: number;
          }
        >
      >()
      .notNull()
      .default({}),
    aiProvider: text("ai_provider").notNull().default("deterministic"),
    aiModel: text("ai_model").notNull().default("opspilot-core-v1"),
    aiApiKeyEncrypted: text("ai_api_key_encrypted"),
    lastSweepDate: text("last_sweep_date"),
    aiUsageMonth: text("ai_usage_month"),
    stripeCustomerId: text("stripe_customer_id").unique(),
    paidThrough: timestamp("paid_through"),
    aiTokensUsed: integer("ai_tokens_used").notNull().default(0),
    aiTokenLimit: integer("ai_token_limit").notNull().default(50000),
    storageBytesUsed: bigint("storage_bytes_used", { mode: "number" })
      .notNull()
      .default(0),
    apiCallsCount: integer("api_calls_count").notNull().default(0),
    dashboardWidgets: jsonb("dashboard_widgets")
      .$type<DashboardWidgetConfig[]>()
      .notNull()
      .default([]),
    rolePermissions: jsonb("role_permissions")
      .$type<Record<string, string[]>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenants_slug_idx").on(t.slug)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull().default("employee"),
    title: text("title"),
    customPermissions: jsonb("custom_permissions")
      .$type<string[] | null>()
      .default(null),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspace_members_tenant_user_idx").on(t.tenantId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<WorkspaceRole>().notNull().default("employee"),
    tokenHash: text("token_hash").notNull(),
    // Legacy column; new codes are represented by tokenHash only.
    inviteCode: text("invite_code"),
    invitedByUserId: integer("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("workspace_invitations_tenant_idx").on(t.tenantId),
    uniqueIndex("workspace_invitations_token_idx").on(t.tokenHash),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeTenantId: integer("active_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_idx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    module: text("module").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_tenant_idx").on(t.tenantId),
    index("audit_logs_created_idx").on(t.tenantId, t.createdAt),
  ],
);

// ============================================================================
// 2. CRM MODULE (CUSTOMERS, COMMUNICATIONS, LEADS & PIPELINE)
// ============================================================================

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    company: text("company").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    address: text("address"),
    customerType: text("customer_type").notNull().default("business"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    assignedUserId: integer("assigned_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedName: text("assigned_name"),
    totalSpentCents: bigint("total_spent_cents", { mode: "number" })
      .notNull()
      .default(0),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customers_tenant_pair").on(t.tenantId, t.id),

    index("customers_tenant_idx").on(t.tenantId),
    index("customers_email_idx").on(t.tenantId, t.email),
  ],
);

export const customerCommunications = pgTable(
  "customer_communications",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    channel: text("channel").notNull().default("note"),
    subject: text("subject").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "customer_communications_customerId_tenant_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),

    index("customer_comms_tenant_idx").on(t.tenantId),
    index("customer_comms_customer_idx").on(t.tenantId, t.customerId),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    contactName: text("contact_name").notNull(),
    company: text("company").notNull(),
    email: text("email"),
    phone: text("phone"),
    source: text("source").notNull().default("Website"),
    estimatedValueCents: bigint("estimated_value_cents", { mode: "number" })
      .notNull()
      .default(0),
    priority: text("priority").notNull().default("medium"),
    stage: text("stage").notNull().default("new"),
    assignedUserId: integer("assigned_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedName: text("assigned_name"),
    followUpDate: text("follow_up_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "leads_customerId_tenant_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),

    index("leads_tenant_idx").on(t.tenantId),
    index("leads_stage_idx").on(t.tenantId, t.stage),
  ],
);

// ============================================================================
// 3. VENDORS, INVENTORY & PROCUREMENT
// ============================================================================

export const vendors = pgTable(
  "vendors",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    address: text("address"),
    category: text("category").notNull().default("General Supplier"),
    taxId: text("tax_id"),
    paymentTerms: text("payment_terms").notNull().default("Net 30"),
    rating: integer("rating").notNull().default(5),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vendors_tenant_pair").on(t.tenantId, t.id),
    index("vendors_tenant_idx").on(t.tenantId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vendorId: integer("vendor_id").references(() => vendors.id, {
      onDelete: "set null",
    }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull().default("General"),
    itemType: text("item_type").notNull().default("product"),
    description: text("description"),
    imageUrl: text("image_url"),
    unit: text("unit").notNull().default("unit"),
    purchasePriceCents: bigint("purchase_price_cents", { mode: "number" })
      .notNull()
      .default(0),
    sellingPriceCents: bigint("selling_price_cents", { mode: "number" })
      .notNull()
      .default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(1800),
    stockQuantity: integer("stock_quantity").notNull().default(0),
    reorderLevel: integer("reorder_level").notNull().default(10),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_tenant_pair").on(t.tenantId, t.id),
    foreignKey({
      name: "products_vendorId_tenant_fk",
      columns: [t.tenantId, t.vendorId],
      foreignColumns: [vendors.tenantId, vendors.id],
    }),

    index("products_tenant_idx").on(t.tenantId),
    uniqueIndex("products_tenant_sku_idx").on(t.tenantId, t.sku),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    movementType: text("movement_type").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    previousStock: integer("previous_stock").notNull(),
    newStock: integer("new_stock").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    reason: text("reason").notNull(),
    actorName: text("actor_name").notNull(),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "stock_movements_productId_tenant_fk",
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),

    index("stock_movements_tenant_idx").on(t.tenantId),
    index("stock_movements_product_idx").on(t.tenantId, t.productId),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    poNumber: text("po_number").notNull(),
    status: text("status").notNull().default("pending_approval"),
    orderDate: text("order_date").notNull(),
    expectedDate: text("expected_date"),
    receivedDate: text("received_date"),
    vendorInvoiceNumber: text("vendor_invoice_number"),
    subtotalCents: bigint("subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    paidCents: bigint("paid_cents", { mode: "number" }).notNull().default(0),
    balanceCents: bigint("balance_cents", { mode: "number" })
      .notNull()
      .default(0),
    notes: text("notes"),
    approvedByName: text("approved_by_name"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("purchase_orders_tenant_pair").on(t.tenantId, t.id),
    foreignKey({
      name: "purchase_orders_vendorId_tenant_fk",
      columns: [t.tenantId, t.vendorId],
      foreignColumns: [vendors.tenantId, vendors.id],
    }),

    index("purchase_orders_tenant_idx").on(t.tenantId),
    uniqueIndex("purchase_orders_number_idx").on(t.tenantId, t.poNumber),
  ],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    purchaseOrderId: integer("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
    taxRateBps: integer("tax_rate_bps").notNull().default(1800),
    lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "purchase_order_items_purchaseOrderId_tenant_fk",
      columns: [t.tenantId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }),
    foreignKey({
      name: "purchase_order_items_productId_tenant_fk",
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    index("po_items_po_idx").on(t.tenantId, t.purchaseOrderId),
  ],
);

// ============================================================================
// 4. SALES, QUOTATIONS, ORDERS & INVOICING
// ============================================================================

export const invoices = pgTable(
  "invoices",
  {
    projectId: integer("project_id"),
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    docType: text("doc_type").notNull().default("invoice"), // quotation | sales_order | invoice
    invoiceNumber: text("invoice_number").notNull(),
    status: text("status").notNull().default("sent"), // draft | sent | approved | partial | paid | overdue | refunded | cancelled
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    discountCents: bigint("discount_cents", { mode: "number" })
      .notNull()
      .default(0),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    paidCents: bigint("paid_cents", { mode: "number" }).notNull().default(0),
    refundedCents: bigint("refunded_cents", { mode: "number" })
      .notNull()
      .default(0),
    balanceCents: bigint("balance_cents", { mode: "number" })
      .notNull()
      .default(0),
    currency: text("currency").notNull().default("INR"),
    notes: text("notes"),
    reminderCount: integer("reminder_count").notNull().default(0),
    lastReminderAt: timestamp("last_reminder_at"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "invoices_project_tenant_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    index("invoices_project_idx").on(t.tenantId, t.projectId),
    uniqueIndex("invoices_tenant_pair").on(t.tenantId, t.id),
    foreignKey({
      name: "invoices_customerId_tenant_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),

    index("invoices_tenant_idx").on(t.tenantId),
    uniqueIndex("invoices_number_idx").on(t.tenantId, t.invoiceNumber),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    discountCents: bigint("discount_cents", { mode: "number" })
      .notNull()
      .default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(1800),
    taxAmountCents: bigint("tax_amount_cents", { mode: "number" })
      .notNull()
      .default(0),
    lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "invoice_items_invoiceId_tenant_fk",
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: "invoice_items_productId_tenant_fk",
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    index("invoice_items_invoice_idx").on(t.tenantId, t.invoiceId),
  ],
);

// ============================================================================
// 5. DOCUMENTS MANAGEMENT
// ============================================================================

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    category: text("category").notNull().default("general"),
    visibility: text("visibility").notNull().default("workspace"), // workspace | managers | hr_only | finance_only
    currentVersion: integer("current_version").notNull().default(1),
    contentBase64: text("content_base64"),
    textPreview: text("text_preview"),
    expiresAt: text("expires_at"),
    uploadedByUserId: integer("uploaded_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    uploaderName: text("uploader_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("documents_tenant_pair").on(t.tenantId, t.id),
    index("documents_tenant_idx").on(t.tenantId),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentBase64: text("content_base64"),
    changeNote: text("change_note").notNull(),
    uploaderName: text("uploader_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "document_versions_documentId_tenant_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    index("doc_versions_doc_idx").on(t.tenantId, t.documentId),
  ],
);

// ============================================================================
// 6. FINANCE & IMMUTABLE LEDGER
// ============================================================================

export const transactions = pgTable(
  "transactions",
  {
    projectId: integer("project_id"),
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entryNumber: text("entry_number").notNull(),
    type: text("type").notNull(), // income | expense | refund | vendor_payment | payroll | reversal
    direction: text("direction").notNull(), // credit (inflow) | debit (outflow)
    category: text("category").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    paymentMethod: text("payment_method").notNull().default("Bank Transfer"),
    transactionDate: text("transaction_date").notNull(),
    description: text("description").notNull(),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    vendorId: integer("vendor_id").references(() => vendors.id, {
      onDelete: "set null",
    }),
    invoiceId: integer("invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    purchaseOrderId: integer("purchase_order_id").references(
      () => purchaseOrders.id,
      {
        onDelete: "set null",
      },
    ),
    receiptDocumentId: integer("receipt_document_id").references(
      () => documents.id,
      {
        onDelete: "set null",
      },
    ),
    status: text("status").notNull().default("posted"), // posted | reversed
    reversalOfId: integer("reversal_of_id"),
    actorName: text("actor_name").notNull(),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "transactions_project_tenant_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    index("transactions_project_idx").on(t.tenantId, t.projectId),
    uniqueIndex("transactions_tenant_pair").on(t.tenantId, t.id),
    foreignKey({
      name: "transactions_customerId_tenant_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: "transactions_vendorId_tenant_fk",
      columns: [t.tenantId, t.vendorId],
      foreignColumns: [vendors.tenantId, vendors.id],
    }),
    foreignKey({
      name: "transactions_invoiceId_tenant_fk",
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: "transactions_purchaseOrderId_tenant_fk",
      columns: [t.tenantId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }),
    foreignKey({
      name: "transactions_receiptDocumentId_tenant_fk",
      columns: [t.tenantId, t.receiptDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),

    index("transactions_tenant_idx").on(t.tenantId),
    index("transactions_date_idx").on(t.tenantId, t.transactionDate),
  ],
);

// ============================================================================
// 7. HRMS (EMPLOYEES, ATTENDANCE, LEAVE, JURISDICTION-AWARE PAYROLL)
// ============================================================================

export const employees = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    employeeCode: text("employee_code").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    department: text("department").notNull(),
    designation: text("designation").notNull(),
    joiningDate: text("joining_date").notNull(),
    employmentStatus: text("employment_status").notNull().default("active"),
    managerName: text("manager_name"),
    jurisdiction: text("jurisdiction").notNull().default("IN"),
    baseSalaryCents: bigint("base_salary_cents", { mode: "number" })
      .notNull()
      .default(0),
    allowancesCents: bigint("allowances_cents", { mode: "number" })
      .notNull()
      .default(0),
    deductionsCents: bigint("deductions_cents", { mode: "number" })
      .notNull()
      .default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(1000),
    leaveBalanceAnnual: integer("leave_balance_annual").notNull().default(18),
    leaveBalanceSick: integer("leave_balance_sick").notNull().default(10),
    confidentialNotes: text("confidential_notes"),
    documentId: integer("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employees_tenant_pair").on(t.tenantId, t.id),
    foreignKey({
      name: "employees_documentId_tenant_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),

    index("employees_tenant_idx").on(t.tenantId),
    uniqueIndex("employees_code_idx").on(t.tenantId, t.employeeCode),
  ],
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    checkInTime: text("check_in_time"),
    checkOutTime: text("check_out_time"),
    status: text("status").notNull().default("present"), // present | late | absent | remote | on_leave
    workMinutes: integer("work_minutes").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "attendance_records_employeeId_tenant_fk",
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),

    index("attendance_tenant_date_idx").on(t.tenantId, t.date),
    uniqueIndex("attendance_emp_date_idx").on(t.tenantId, t.employeeId, t.date),
  ],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveType: text("leave_type").notNull().default("annual"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    days: integer("days").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    reviewerName: text("reviewer_name"),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "leave_requests_employeeId_tenant_fk",
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    index("leave_requests_tenant_idx").on(t.tenantId),
  ],
);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // YYYY-MM
    jurisdiction: text("jurisdiction").notNull().default("IN"),
    statutoryLabel: text("statutory_label").notNull().default("PF/ESI & TDS"),
    baseSalaryCents: bigint("base_salary_cents", { mode: "number" }).notNull(),
    allowancesCents: bigint("allowances_cents", { mode: "number" }).notNull(),
    statutoryDeductionCents: bigint("statutory_deduction_cents", {
      mode: "number",
    }).notNull(),
    taxDeductionCents: bigint("tax_deduction_cents", {
      mode: "number",
    }).notNull(),
    netPayCents: bigint("net_pay_cents", { mode: "number" }).notNull(),
    status: text("status").notNull().default("processed"), // processed | paid
    paidAt: timestamp("paid_at"),
    transactionId: integer("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "payroll_runs_employeeId_tenant_fk",
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({
      name: "payroll_runs_transactionId_tenant_fk",
      columns: [t.tenantId, t.transactionId],
      foreignColumns: [transactions.tenantId, transactions.id],
    }),

    index("payroll_tenant_idx").on(t.tenantId),
    uniqueIndex("payroll_emp_period_idx").on(
      t.tenantId,
      t.employeeId,
      t.period,
    ),
  ],
);

// ============================================================================
// 8. PROJECT & TASK MANAGEMENT
// ============================================================================

export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    budgetCents: bigint("budget_cents", { mode: "number" })
      .notNull()
      .default(0),
    spentCents: bigint("spent_cents", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("active"), // planning | active | delayed | on_hold | completed
    startDate: text("start_date").notNull(),
    deadline: text("deadline").notNull(),
    teamMembers: jsonb("team_members").$type<string[]>().notNull().default([]),
    ownerName: text("owner_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_tenant_pair").on(t.tenantId, t.id),
    foreignKey({
      name: "projects_customerId_tenant_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    index("projects_tenant_idx").on(t.tenantId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    assigneeUserId: integer("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assigneeName: text("assignee_name"),
    priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
    status: text("status").notNull().default("todo"), // todo | in_progress | review | done
    dueDate: text("due_date"),
    attachmentDocumentId: integer("attachment_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tasks_tenant_pair").on(t.tenantId, t.id),
    foreignKey({
      name: "tasks_projectId_tenant_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: "tasks_attachmentDocumentId_tenant_fk",
      columns: [t.tenantId, t.attachmentDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),

    index("tasks_tenant_idx").on(t.tenantId),
    index("tasks_project_idx").on(t.tenantId, t.projectId),
  ],
);

export const taskComments = pgTable(
  "task_comments",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "task_comments_taskId_tenant_fk",
      columns: [t.tenantId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }),
    index("task_comments_task_idx").on(t.tenantId, t.taskId),
  ],
);

// ============================================================================
// 9. WORKFLOW AUTOMATION ENGINE
// ============================================================================

export interface WorkflowCondition {
  field: string;
  operator: "eq" | "neq" | "gt" | "lt" | "contains";
  value: string | number;
}

export interface WorkflowAction {
  type:
    | "notify"
    | "create_task"
    | "send_invoice_reminder"
    | "delay"
    | "require_approval"
    | "log_audit";
  targetRole?: string;
  title?: string;
  message?: string;
  priority?: string;
  delayMinutes?: number;
}

export const workflows = pgTable(
  "workflows",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    triggerEvent: text("trigger_event").notNull(), // lead.created | invoice.overdue | stock.low | leave.requested | task.overdue | invoice.paid | schedule.daily
    scheduleExpression: text("schedule_expression"),
    conditions: jsonb("conditions")
      .$type<WorkflowCondition[]>()
      .notNull()
      .default([]),
    actions: jsonb("actions").$type<WorkflowAction[]>().notNull().default([]),
    approvalStatus: text("approval_status")
      .notNull()
      .default("pending_approval"), // draft | pending_approval | approved
    approvedByName: text("approved_by_name"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    generatedByAi: boolean("generated_by_ai").notNull().default(false),
    retryLimit: integer("retry_limit").notNull().default(2),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: timestamp("last_run_at"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workflows_tenant_pair").on(t.tenantId, t.id),
    index("workflows_tenant_idx").on(t.tenantId),
  ],
);

export const workflowExecutions = pgTable(
  "workflow_executions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: integer("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workflowName: text("workflow_name").notNull(),
    triggerEvent: text("trigger_event").notNull(),
    status: text("status").notNull().default("completed"), // completed | awaiting_approval | scheduled | failed
    attemptCount: integer("attempt_count").notNull().default(1),
    nextStep: integer("next_step").notNull().default(0),
    runAfter: timestamp("run_after").notNull().defaultNow(),
    eventKey: text("event_key"),
    triggerPayload: jsonb("trigger_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    stepLogs: jsonb("step_logs")
      .$type<
        Array<{ step: string; status: string; detail: string; at: string }>
      >()
      .notNull()
      .default([]),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    foreignKey({
      name: "workflow_executions_workflowId_tenant_fk",
      columns: [t.tenantId, t.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }),
    index("workflow_exec_tenant_idx").on(t.tenantId),
    index("workflow_exec_due_idx").on(t.status, t.runAfter),
    uniqueIndex("workflow_event_once_idx").on(t.workflowId, t.eventKey),
  ],
);

// ============================================================================
// 10. NOTIFICATIONS, OPSPILOT AI & BILLING
// ============================================================================

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    targetRole: text("target_role"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    type: text("type").notNull().default("info"), // info | success | warning | alert | automation
    link: text("link"),
    isRead: boolean("is_read").notNull().default(false),
    emailQueued: boolean("email_queued").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("notifications_tenant_idx").on(t.tenantId, t.isRead)],
);

export interface AiPendingAction {
  id: string;
  actionType:
    | "send_overdue_reminders"
    | "create_task"
    | "create_workflow_draft";
  summary: string;
  payload: Record<string, unknown>;
  status: "pending" | "confirmed" | "cancelled";
}

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    toolsUsed: jsonb("tools_used").$type<string[]>().notNull().default([]),
    structuredData: jsonb("structured_data")
      .$type<Record<string, unknown> | null>()
      .default(null),
    accessScope: text("access_scope"),
    pendingAction: jsonb("pending_action")
      .$type<AiPendingAction | null>()
      .default(null),
    tokensUsed: integer("tokens_used").notNull().default(0),
    provider: text("provider").notNull().default("deterministic"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ai_messages_tenant_user_idx").on(t.tenantId, t.userId)],
);

export const billingEvents = pgTable(
  "billing_events",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    previousPlan: text("previous_plan").notNull(),
    newPlan: text("new_plan").notNull(),
    amountInr: integer("amount_inr").notNull().default(0),
    description: text("description").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("billing_events_tenant_idx").on(t.tenantId)],
);

export const rateWindows = pgTable(
  "rate_windows",
  {
    key: text("key").primaryKey(),
    hits: integer("hits").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_window_expiry").on(t.expiresAt)],
);

// Only encrypted delivery payloads are retained while queued; terminal rows record status only.
export const mailJobs = pgTable(
  "mail_jobs",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: text("payload"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [index("mail_due_idx").on(t.status, t.runAfter)],
);

export const gatewayEvents = pgTable("gateway_events", {
  eventId: text("event_id").primaryKey(),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const subscriptionInvoices = pgTable(
  "subscription_invoices",
  {
    invoiceId: text("invoice_id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    subscriptionId: text("subscription_id").notNull(),
    chargeId: text("charge_id").unique(),
    plan: text("plan").$type<PlanTier>().notNull(),
    amountCents: integer("amount_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    currency: text("currency").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("subscription_invoice_workspace_idx").on(t.tenantId, t.periodEnd),
  ],
);
export const projectTime = pgTable(
  "project_time",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    minutes: integer("minutes").notNull(),
    workDate: text("work_date").notNull(),
  },
  (t) => [
    foreignKey({
      name: "project_time_projectId_tenant_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    index("project_time_workspace_idx").on(t.tenantId, t.projectId),
  ],
);

// Minimal product telemetry: no user identifiers, search terms, or financial values.
export const workspaceActivity = pgTable(
  "workspace_activity",
  {
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    module: text("module").notNull(),
    requests: integer("requests").notNull().default(1),
  },
  (t) => [
    uniqueIndex("workspace_activity_once_idx").on(t.tenantId, t.day, t.module),
    index("workspace_activity_day_idx").on(t.day),
  ],
);
export const milestones = pgTable(
  "workspace_milestones",
  {
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    reachedAt: timestamp("reached_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspace_milestone_once_idx").on(t.tenantId, t.step)],
);

// A read receipt belongs to one user; a broadcast's state must not change for their teammates.
export const notificationReads = pgTable(
  "notification_reads",
  {
    notificationId: integer("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("notification_read_once").on(t.notificationId, t.userId)],
);
