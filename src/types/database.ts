// Generado desde el proyecto real con `npm run db:types`. No editar a mano.
//
// EXCEPCIÓN del 6/11/2026: las tres tablas de F3 (`billing_documents`,
// `cash_movements`, `payment_allocations`), la vista `account_balances`, sus
// cuatro funciones y sus cinco enums se escribieron a mano, porque el token
// del CLI no tiene permiso para el endpoint de tipos y `npm run db:types`
// contesta `LegacyGenTypesUnexpectedStatusError`. Están copiados del esquema
// real, verificado el mismo día. En cuanto el CLI pueda, hay que regenerar el
// archivo entero y esta nota se cae.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          at: string
          before: Json | null
          entity_id: string | null
          entity_table: string
          id: number
          organization_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity_id?: string | null
          entity_table: string
          id?: number
          organization_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity_id?: string | null
          entity_table?: string
          id?: number
          organization_id?: string | null
        }
        Relationships: []
      }
      billing_documents: {
        Row: {
          amount_net: number
          amount_tax: number
          amount_total: number
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string
          currency_code: string
          description: string | null
          direction: string
          doc_type: Database["public"]["Enums"]["document_type"]
          due_date: string | null
          id: string
          is_opening: boolean
          issue_date: string
          legal_entity_id: string
          organization_id: string
          quote_version_id: string | null
          series_number: string | null
          status: Database["public"]["Enums"]["document_status"]
          supplier_id: string | null
          tax_rate: number | null
          updated_at: string
          void_reason: string | null
        }
        Insert: {
          amount_net: number
          amount_tax?: number
          amount_total: number
          category_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string
          currency_code: string
          description?: string | null
          direction?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          due_date?: string | null
          id?: string
          is_opening?: boolean
          issue_date?: string
          legal_entity_id: string
          organization_id: string
          quote_version_id?: string | null
          series_number?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          supplier_id?: string | null
          tax_rate?: number | null
          updated_at?: string
          void_reason?: string | null
        }
        Update: {
          amount_net?: number
          amount_tax?: number
          amount_total?: number
          category_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string
          currency_code?: string
          description?: string | null
          direction?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          due_date?: string | null
          id?: string
          is_opening?: boolean
          issue_date?: string
          legal_entity_id?: string
          organization_id?: string
          quote_version_id?: string | null
          series_number?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          supplier_id?: string | null
          tax_rate?: number | null
          updated_at?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_documents_client_id_organization_id_fkey"
            columns: ["client_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "billing_documents_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "billing_documents_legal_entity_id_organization_id_fkey"
            columns: ["legal_entity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "billing_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_documents_quote_version_id_organization_id_fkey"
            columns: ["quote_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "billing_documents_proveedor_fkey"
            columns: ["supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "billing_documents_categoria_fkey"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      brands: {
        Row: {
          accent_color: string | null
          accent_secondary: string | null
          cover_path: string | null
          created_at: string
          id: string
          is_active: boolean
          legal_entity_id: string
          logo_path: string | null
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          accent_secondary?: string | null
          cover_path?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          legal_entity_id: string
          logo_path?: string | null
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          accent_secondary?: string | null
          cover_path?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          legal_entity_id?: string
          logo_path?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_accounts: {
        Row: {
          account_ref_masked: string | null
          bank_name: string | null
          created_at: string
          currency_code: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["account_kind"]
          legal_entity_id: string
          name: string
          organization_id: string
          sort: number
          updated_at: string
        }
        Insert: {
          account_ref_masked?: string | null
          bank_name?: string | null
          created_at?: string
          currency_code: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["account_kind"]
          legal_entity_id: string
          name: string
          organization_id: string
          sort?: number
          updated_at?: string
        }
        Update: {
          account_ref_masked?: string | null
          bank_name?: string | null
          created_at?: string
          currency_code?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["account_kind"]
          legal_entity_id?: string
          name?: string
          organization_id?: string
          sort?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_accounts_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "cash_accounts_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          amount_net: number | null
          amount_tax: number | null
          booked_at: string
          cash_account_id: string
          category_id: string | null
          client_id: string | null
          counterparty_kind: string | null
          created_at: string
          created_by: string
          currency_code: string
          description: string
          direction: Database["public"]["Enums"]["cash_direction"]
          external_ref: string | null
          flow_class: Database["public"]["Enums"]["flow_class"]
          id: string
          is_void: boolean
          kind: Database["public"]["Enums"]["cash_kind"]
          legal_entity_id: string
          organization_id: string
          recurring_expense_id: string | null
          source: string
          supplier_id: string | null
          transfer_id: string | null
          value_date: string
          void_reason: string | null
        }
        Insert: {
          amount: number
          amount_net?: number | null
          amount_tax?: number | null
          booked_at?: string
          cash_account_id: string
          category_id?: string | null
          client_id?: string | null
          counterparty_kind?: string | null
          created_at?: string
          created_by?: string
          currency_code: string
          description: string
          direction: Database["public"]["Enums"]["cash_direction"]
          external_ref?: string | null
          id?: string
          is_void?: boolean
          kind?: Database["public"]["Enums"]["cash_kind"]
          legal_entity_id: string
          organization_id: string
          recurring_expense_id?: string | null
          source?: string
          supplier_id?: string | null
          transfer_id?: string | null
          value_date: string
          void_reason?: string | null
        }
        Update: {
          amount?: number
          amount_net?: number | null
          amount_tax?: number | null
          booked_at?: string
          cash_account_id?: string
          category_id?: string | null
          client_id?: string | null
          counterparty_kind?: string | null
          created_at?: string
          created_by?: string
          currency_code?: string
          description?: string
          direction?: Database["public"]["Enums"]["cash_direction"]
          external_ref?: string | null
          id?: string
          is_void?: boolean
          kind?: Database["public"]["Enums"]["cash_kind"]
          legal_entity_id?: string
          organization_id?: string
          recurring_expense_id?: string | null
          source?: string
          supplier_id?: string | null
          transfer_id?: string | null
          value_date?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_cash_account_id_organization_id_legal_entit_fkey"
            columns: [
              "cash_account_id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: [
              "id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
          },
          {
            foreignKeyName: "cash_movements_category_id_organization_id_fkey"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_movements_client_id_organization_id_fkey"
            columns: ["client_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_movements_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "cash_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_proveedor_fkey"
            columns: ["supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_movements_recurrente_fkey"
            columns: [
              "recurring_expense_id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: [
              "id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_items: {
        Row: {
          created_at: string
          currency_code: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["cost_item_kind"]
          legal_entity_id: string | null
          name: string
          notes: string | null
          organization_id: string
          unit: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency_code: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["cost_item_kind"]
          legal_entity_id?: string | null
          name: string
          notes?: string | null
          organization_id: string
          unit?: string
          unit_cost: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency_code?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["cost_item_kind"]
          legal_entity_id?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_items_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "cost_items_entidad_fkey"
            columns: ["legal_entity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cost_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          minor_units: number
          name: string
          symbol: string
        }
        Insert: {
          code: string
          minor_units?: number
          name: string
          symbol: string
        }
        Update: {
          code?: string
          minor_units?: number
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      financial_categories: {
        Row: {
          created_at: string
          direction: Database["public"]["Enums"]["category_direction"]
          id: string
          is_active: boolean
          name: string
          organization_id: string
          parent_id: string | null
          sort: number
        }
        Insert: {
          created_at?: string
          direction?: Database["public"]["Enums"]["category_direction"]
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          parent_id?: string | null
          sort?: number
        }
        Update: {
          created_at?: string
          direction?: Database["public"]["Enums"]["category_direction"]
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          parent_id?: string | null
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          as_of: string
          created_at: string
          created_by: string | null
          from_code: string
          id: string
          kind: Database["public"]["Enums"]["fx_rate_kind"]
          organization_id: string | null
          rate: number
          source: string
          to_code: string
        }
        Insert: {
          as_of: string
          created_at?: string
          created_by?: string | null
          from_code: string
          id?: string
          kind?: Database["public"]["Enums"]["fx_rate_kind"]
          organization_id?: string | null
          rate: number
          source: string
          to_code: string
        }
        Update: {
          as_of?: string
          created_at?: string
          created_by?: string | null
          from_code?: string
          id?: string
          kind?: Database["public"]["Enums"]["fx_rate_kind"]
          organization_id?: string | null
          rate?: number
          source?: string
          to_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "fx_rates_from_code_fkey"
            columns: ["from_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fx_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_rates_to_code_fkey"
            columns: ["to_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      legal_entities: {
        Row: {
          address: string | null
          archived_reason: string | null
          country: string
          created_at: string
          default_currency_code: string
          email: string | null
          id: string
          is_active: boolean
          legal_name: string
          organization_id: string
          phone: string | null
          quote_terms: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_reason?: string | null
          country: string
          created_at?: string
          default_currency_code: string
          email?: string | null
          id?: string
          is_active?: boolean
          legal_name: string
          organization_id: string
          phone?: string | null
          quote_terms?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_reason?: string | null
          country?: string
          created_at?: string
          default_currency_code?: string
          email?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string
          organization_id?: string
          phone?: string | null
          quote_terms?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_entities_default_currency_code_fkey"
            columns: ["default_currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "legal_entities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["membership_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_media: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          label: string | null
          organization_id: string
          path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          organization_id: string
          path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          organization_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_media_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_currencies: {
        Row: {
          currency_code: string
          enabled_at: string
          is_enabled: boolean
          organization_id: string
        }
        Insert: {
          currency_code: string
          enabled_at?: string
          is_enabled?: boolean
          organization_id: string
        }
        Update: {
          currency_code?: string
          enabled_at?: string
          is_enabled?: boolean
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_currencies_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "organization_currencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          country: string
          created_at: string
          created_by: string | null
          display_currency_code: string
          id: string
          name: string
          requires_plan_reconciliation: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          country?: string
          created_at?: string
          created_by?: string | null
          display_currency_code?: string
          id?: string
          name: string
          requires_plan_reconciliation?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          country?: string
          created_at?: string
          created_by?: string | null
          display_currency_code?: string
          id?: string
          name?: string
          requires_plan_reconciliation?: boolean
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_allocations: {
        Row: {
          amount: number
          billing_document_id: string | null
          cash_movement_id: string
          created_at: string
          created_by: string
          currency_code: string
          id: string
          legal_entity_id: string
          organization_id: string
          payment_schedule_item_id: string | null
        }
        Insert: {
          amount: number
          billing_document_id?: string | null
          cash_movement_id: string
          created_at?: string
          created_by?: string
          currency_code: string
          id?: string
          legal_entity_id: string
          organization_id: string
          payment_schedule_item_id?: string | null
        }
        Update: {
          amount?: number
          billing_document_id?: string | null
          cash_movement_id?: string
          created_at?: string
          created_by?: string
          currency_code?: string
          id?: string
          legal_entity_id?: string
          organization_id?: string
          payment_schedule_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_billing_document_id_organization_id_le_fkey"
            columns: [
              "billing_document_id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
            isOneToOne: false
            referencedRelation: "billing_documents"
            referencedColumns: [
              "id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
          },
          {
            foreignKeyName: "payment_allocations_cash_movement_id_organization_id_legal_fkey"
            columns: [
              "cash_movement_id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: [
              "id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
          },
          {
            foreignKeyName: "payment_allocations_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payment_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_schedule_item_id_organization__fkey"
            columns: [
              "payment_schedule_item_id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
            isOneToOne: false
            referencedRelation: "payment_schedule_items"
            referencedColumns: [
              "id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
          },
        ]
      }
      payment_schedule_items: {
        Row: {
          amount: number
          billing_document_id: string | null
          created_at: string
          currency_code: string
          direction: string
          due_date: string
          expected_cash_account_id: string | null
          id: string
          label: string
          legal_entity_id: string
          organization_id: string
          quote_id: string | null
          quote_version_id: string | null
          sort: number
          status: Database["public"]["Enums"]["schedule_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          billing_document_id?: string | null
          created_at?: string
          currency_code: string
          direction?: string
          due_date: string
          expected_cash_account_id?: string | null
          id?: string
          label: string
          legal_entity_id: string
          organization_id: string
          quote_id?: string | null
          quote_version_id?: string | null
          sort?: number
          status?: Database["public"]["Enums"]["schedule_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          billing_document_id?: string | null
          created_at?: string
          currency_code?: string
          direction?: string
          due_date?: string
          expected_cash_account_id?: string | null
          id?: string
          label?: string
          legal_entity_id?: string
          organization_id?: string
          quote_id?: string | null
          quote_version_id?: string | null
          sort?: number
          status?: Database["public"]["Enums"]["schedule_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_schedule_items_billing_document_id_organization_i_fkey"
            columns: [
              "billing_document_id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
            isOneToOne: false
            referencedRelation: "billing_documents"
            referencedColumns: [
              "id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
          },
          {
            foreignKeyName: "payment_schedule_items_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payment_schedule_items_expected_cash_account_id_organizati_fkey"
            columns: [
              "expected_cash_account_id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: [
              "id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
          },
          {
            foreignKeyName: "payment_schedule_items_legal_entity_id_organization_id_fkey"
            columns: ["legal_entity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payment_schedule_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_schedule_items_quote_id_organization_id_legal_enti_fkey"
            columns: [
              "quote_id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: [
              "id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
          },
          {
            foreignKeyName: "payment_schedule_items_quote_version_id_organization_id_fkey"
            columns: ["quote_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      plan_entitlements: {
        Row: {
          key: string
          plan_code: string
          value_bool: boolean | null
          value_int: number | null
        }
        Insert: {
          key: string
          plan_code: string
          value_bool?: boolean | null
          value_int?: number | null
        }
        Update: {
          key?: string
          plan_code?: string
          value_bool?: boolean | null
          value_int?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_entitlements_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          is_public: boolean
          name: string
          sort: number
        }
        Insert: {
          code: string
          is_public?: boolean
          name: string
          sort?: number
        }
        Update: {
          code?: string
          is_public?: boolean
          name?: string
          sort?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      quote_events: {
        Row: {
          action: string
          actor_id: string | null
          at: string
          from_status: Database["public"]["Enums"]["quote_status"] | null
          id: number
          note: string | null
          organization_id: string
          quote_id: string
          to_status: Database["public"]["Enums"]["quote_status"] | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          at?: string
          from_status?: Database["public"]["Enums"]["quote_status"] | null
          id?: number
          note?: string | null
          organization_id: string
          quote_id: string
          to_status?: Database["public"]["Enums"]["quote_status"] | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          at?: string
          from_status?: Database["public"]["Enums"]["quote_status"] | null
          id?: number
          note?: string | null
          organization_id?: string
          quote_id?: string
          to_status?: Database["public"]["Enums"]["quote_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_events_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_line_costs: {
        Row: {
          cost_item_id: string | null
          created_at: string
          fx_as_of: string | null
          fx_rate: number | null
          id: string
          is_active: boolean
          label: string | null
          organization_id: string
          quantity: number
          quote_line_id: string
          sort: number
          source_currency: string | null
          source_unit_cost: number | null
          unit: string
          unit_cost: number
        }
        Insert: {
          cost_item_id?: string | null
          created_at?: string
          fx_as_of?: string | null
          fx_rate?: number | null
          id?: string
          is_active?: boolean
          label?: string | null
          organization_id: string
          quantity: number
          quote_line_id: string
          sort?: number
          source_currency?: string | null
          source_unit_cost?: number | null
          unit?: string
          unit_cost: number
        }
        Update: {
          cost_item_id?: string | null
          created_at?: string
          fx_as_of?: string | null
          fx_rate?: number | null
          id?: string
          is_active?: boolean
          label?: string | null
          organization_id?: string
          quantity?: number
          quote_line_id?: string
          sort?: number
          source_currency?: string | null
          source_unit_cost?: number | null
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_line_costs_cost_item_id_organization_id_fkey"
            columns: ["cost_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cost_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "quote_line_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_costs_quote_line_id_organization_id_fkey"
            columns: ["quote_line_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "quote_lines"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "quote_line_costs_source_currency_fkey"
            columns: ["source_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      quote_line_terms: {
        Row: {
          content: string
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["term_kind"]
          organization_id: string
          quote_line_id: string
          sort: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["term_kind"]
          organization_id: string
          quote_line_id: string
          sort?: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["term_kind"]
          organization_id?: string
          quote_line_id?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_line_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_terms_quote_line_id_organization_id_fkey"
            columns: ["quote_line_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "quote_lines"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      quote_lines: {
        Row: {
          created_at: string
          description: string
          fee_pct: number | null
          id: string
          is_active: boolean
          organization_id: string
          public_detail: string | null
          public_summary: string | null
          quantity: number
          quote_id: string
          service_id: string | null
          sort: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          fee_pct?: number | null
          id?: string
          is_active?: boolean
          organization_id: string
          public_detail?: string | null
          public_summary?: string | null
          quantity: number
          quote_id: string
          service_id?: string | null
          sort?: number
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          fee_pct?: number | null
          id?: string
          is_active?: boolean
          organization_id?: string
          public_detail?: string | null
          public_summary?: string | null
          quantity?: number
          quote_id?: string
          service_id?: string | null
          sort?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_lines_quote_id_organization_id_fkey"
            columns: ["quote_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "quote_lines_service_id_organization_id_fkey"
            columns: ["service_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      quote_version_costs: {
        Row: {
          cost: number
          margin_pct: number | null
          markup_pct: number | null
          organization_id: string
          profit: number
          quote_version_id: string
        }
        Insert: {
          cost: number
          margin_pct?: number | null
          markup_pct?: number | null
          organization_id: string
          profit: number
          quote_version_id: string
        }
        Update: {
          cost?: number
          margin_pct?: number | null
          markup_pct?: number | null
          organization_id?: string
          profit?: number
          quote_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_version_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_version_costs_quote_version_id_fkey"
            columns: ["quote_version_id"]
            isOneToOne: true
            referencedRelation: "quote_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_versions: {
        Row: {
          id: string
          issued_at: string
          issued_by: string | null
          organization_id: string
          quote_id: string
          snapshot: Json
          snapshot_sha256: string
          totals: Json
          version_no: number
        }
        Insert: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          organization_id: string
          quote_id: string
          snapshot: Json
          snapshot_sha256: string
          totals: Json
          version_no: number
        }
        Update: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          organization_id?: string
          quote_id?: string
          snapshot?: Json
          snapshot_sha256?: string
          totals?: Json
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_versions_quote_id_organization_id_fkey"
            columns: ["quote_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      quotes: {
        Row: {
          brand_id: string | null
          client_id: string
          created_at: string
          currency_code: string
          design: Json
          id: string
          legal_entity_id: string
          notes: string | null
          number: string
          organization_id: string
          status: Database["public"]["Enums"]["quote_status"]
          tax_included: boolean
          tax_label: string | null
          tax_rate_pct: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          brand_id?: string | null
          client_id: string
          created_at?: string
          currency_code: string
          design?: Json
          id?: string
          legal_entity_id: string
          notes?: string | null
          number: string
          organization_id: string
          status?: Database["public"]["Enums"]["quote_status"]
          tax_included?: boolean
          tax_label?: string | null
          tax_rate_pct?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          brand_id?: string | null
          client_id?: string
          created_at?: string
          currency_code?: string
          design?: Json
          id?: string
          legal_entity_id?: string
          notes?: string | null
          number?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["quote_status"]
          tax_included?: boolean
          tax_label?: string | null
          tax_rate_pct?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "quotes_client_id_organization_id_fkey"
            columns: ["client_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "quotes_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "quotes_legal_entity_id_organization_id_fkey"
            columns: ["legal_entity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expenses: {
        Row: {
          amount: number
          cadence: Database["public"]["Enums"]["recurrence"]
          cash_account_id: string | null
          category_id: string | null
          cost_item_id: string | null
          created_at: string
          created_by: string
          currency_code: string
          day_of_month: number | null
          ends_on: string | null
          id: string
          is_active: boolean
          label: string
          legal_entity_id: string
          notes: string | null
          organization_id: string
          starts_on: string
          updated_at: string
        }
        Insert: {
          amount: number
          cadence?: Database["public"]["Enums"]["recurrence"]
          cash_account_id?: string | null
          category_id?: string | null
          cost_item_id?: string | null
          created_at?: string
          created_by?: string
          currency_code: string
          day_of_month?: number | null
          ends_on?: string | null
          id?: string
          is_active?: boolean
          label: string
          legal_entity_id: string
          notes?: string | null
          organization_id: string
          starts_on: string
          updated_at?: string
        }
        Update: {
          amount?: number
          cadence?: Database["public"]["Enums"]["recurrence"]
          cash_account_id?: string | null
          category_id?: string | null
          cost_item_id?: string | null
          created_at?: string
          created_by?: string
          currency_code?: string
          day_of_month?: number | null
          ends_on?: string | null
          id?: string
          is_active?: boolean
          label?: string
          legal_entity_id?: string
          notes?: string | null
          organization_id?: string
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_cash_account_id_organization_id_legal_fkey"
            columns: [
              "cash_account_id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: [
              "id",
              "organization_id",
              "legal_entity_id",
              "currency_code",
            ]
          },
          {
            foreignKeyName: "recurring_expenses_category_id_organization_id_fkey"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "recurring_expenses_cost_item_id_organization_id_fkey"
            columns: ["cost_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cost_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "recurring_expenses_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "recurring_expenses_legal_entity_id_organization_id_fkey"
            columns: ["legal_entity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "recurring_expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          sort: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          sort?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_cost_lines: {
        Row: {
          cost_item_id: string | null
          created_at: string
          currency_code: string
          id: string
          label: string | null
          organization_id: string
          quantity: number
          service_id: string
          sort: number
          source_currency: string | null
          source_unit_cost: number | null
          unit: string
          unit_cost: number
        }
        Insert: {
          cost_item_id?: string | null
          created_at?: string
          currency_code: string
          id?: string
          label?: string | null
          organization_id: string
          quantity: number
          service_id: string
          sort?: number
          source_currency?: string | null
          source_unit_cost?: number | null
          unit?: string
          unit_cost: number
        }
        Update: {
          cost_item_id?: string | null
          created_at?: string
          currency_code?: string
          id?: string
          label?: string | null
          organization_id?: string
          quantity?: number
          service_id?: string
          sort?: number
          source_currency?: string | null
          source_unit_cost?: number | null
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_cost_lines_cost_item_id_organization_id_fkey"
            columns: ["cost_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cost_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "service_cost_lines_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "service_cost_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_cost_lines_service_id_organization_id_fkey"
            columns: ["service_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "service_cost_lines_source_currency_fkey"
            columns: ["source_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      service_terms: {
        Row: {
          content: string
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["term_kind"]
          organization_id: string
          service_id: string
          sort: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["term_kind"]
          organization_id: string
          service_id: string
          sort?: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["term_kind"]
          organization_id?: string
          service_id?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_terms_service_id_organization_id_fkey"
            columns: ["service_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      services: {
        Row: {
          category_id: string | null
          code: string
          cover_path: string | null
          created_at: string
          default_fee_pct: number
          description: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["service_kind"]
          legal_entity_id: string
          name: string
          organization_id: string
          periodicity: string | null
          suggested_currency_code: string | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          code: string
          cover_path?: string | null
          created_at?: string
          default_fee_pct?: number
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["service_kind"]
          legal_entity_id: string
          name: string
          organization_id: string
          periodicity?: string | null
          suggested_currency_code?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          code?: string
          cover_path?: string | null
          created_at?: string
          default_fee_pct?: number
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["service_kind"]
          legal_entity_id?: string
          name?: string
          organization_id?: string
          periodicity?: string | null
          suggested_currency_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_entidad_fkey"
            columns: ["legal_entity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_suggested_currency_code_fkey"
            columns: ["suggested_currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at: string | null
          created_at: string
          current_period_end: string | null
          organization_id: string
          plan_code: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          cancel_at?: string | null
          created_at?: string
          current_period_end?: string | null
          organization_id: string
          plan_code: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at?: string | null
          created_at?: string
          current_period_end?: string | null
          organization_id?: string
          plan_code?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          legal_entity_id: string
          name: string
          organization_id: string
          rate: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          legal_entity_id: string
          name: string
          organization_id: string
          rate: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          legal_entity_id?: string
          name?: string
          organization_id?: string
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          amount_from: number
          amount_to: number
          created_at: string
          created_by: string
          currency_from: string
          currency_to: string
          description: string
          external_ref: string | null
          fee_account_id: string | null
          fee_amount: number | null
          from_account_id: string
          fx_rate: number | null
          id: string
          legal_entity_id: string
          organization_id: string
          to_account_id: string
          value_date: string
        }
        Insert: {
          amount_from: number
          amount_to: number
          created_at?: string
          created_by?: string
          currency_from: string
          currency_to: string
          description: string
          external_ref?: string | null
          fee_account_id?: string | null
          fee_amount?: number | null
          from_account_id: string
          id?: string
          legal_entity_id: string
          organization_id: string
          to_account_id: string
          value_date: string
        }
        Update: {
          amount_from?: number
          amount_to?: number
          created_at?: string
          created_by?: string
          currency_from?: string
          currency_to?: string
          description?: string
          external_ref?: string | null
          fee_account_id?: string | null
          fee_amount?: number | null
          from_account_id?: string
          id?: string
          legal_entity_id?: string
          organization_id?: string
          to_account_id?: string
          value_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      economic_facts: {
        Row: {
          amount_net: number | null
          amount_tax: number | null
          amount_total: number | null
          category_id: string | null
          client_id: string | null
          concepto: string | null
          currency_code: string | null
          direction: Database["public"]["Enums"]["cash_direction"] | null
          fecha: string | null
          flow_class: Database["public"]["Enums"]["flow_class"] | null
          kind: Database["public"]["Enums"]["cash_kind"] | null
          legal_entity_id: string | null
          organization_id: string | null
          origen: string | null
          source_id: string | null
          supplier_id: string | null
        }
        Relationships: []
      }
      account_balances: {
        Row: {
          balance: number | null
          cash_account_id: string | null
          currency_code: string | null
          legal_entity_id: string | null
          movimientos: number | null
          organization_id: string | null
          ultimo_movimiento: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_quote_line_from_service: {
        Args: { p_quantity?: number; p_quote: string; p_service: string }
        Returns: string
      }
      anular_documento: {
        Args: {
          p_document: string
          p_motivo: string
        }
        Returns: {
          amount_net: number
          amount_tax: number
          amount_total: number
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string
          currency_code: string
          description: string | null
          direction: string
          doc_type: Database["public"]["Enums"]["document_type"]
          due_date: string | null
          id: string
          is_opening: boolean
          issue_date: string
          legal_entity_id: string
          organization_id: string
          quote_version_id: string | null
          series_number: string | null
          status: Database["public"]["Enums"]["document_status"]
          supplier_id: string | null
          tax_rate: number | null
          updated_at: string
          void_reason: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "billing_documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      anular_movimiento: {
        Args: { p_motivo: string; p_movement: string }
        Returns: {
          amount: number
          amount_net: number | null
          amount_tax: number | null
          booked_at: string
          cash_account_id: string
          category_id: string | null
          client_id: string | null
          counterparty_kind: string | null
          created_at: string
          created_by: string
          currency_code: string
          description: string
          direction: Database["public"]["Enums"]["cash_direction"]
          external_ref: string | null
          flow_class: Database["public"]["Enums"]["flow_class"]
          id: string
          is_void: boolean
          kind: Database["public"]["Enums"]["cash_kind"]
          legal_entity_id: string
          organization_id: string
          recurring_expense_id: string | null
          source: string
          supplier_id: string | null
          transfer_id: string | null
          value_date: string
          void_reason: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "cash_movements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      archivar_gasto_recurrente: {
        Args: { p_id: string; p_motivo?: string }
        Returns: {
          amount: number
          cadence: Database["public"]["Enums"]["recurrence"]
          cash_account_id: string | null
          category_id: string | null
          cost_item_id: string | null
          created_at: string
          created_by: string
          currency_code: string
          day_of_month: number | null
          ends_on: string | null
          id: string
          is_active: boolean
          label: string
          legal_entity_id: string
          notes: string | null
          organization_id: string
          starts_on: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "recurring_expenses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cambiar_estado_cotizacion: {
        Args: {
          p_note?: string
          p_quote: string
          p_to: Database["public"]["Enums"]["quote_status"]
        }
        Returns: Database["public"]["Enums"]["quote_status"]
      }
      create_organization: {
        Args: { p_currency?: string; p_name: string }
        Returns: string
      }
      emitir_cotizacion: {
        Args: { p_note?: string; p_quote: string }
        Returns: {
          snapshot_sha256: string
          version_no: number
        }[]
      }
      emitir_documento: {
        Args: {
          p_doc_type?: Database["public"]["Enums"]["document_type"]
          p_due_date?: string
          p_issue_date?: string
          p_item: string
          p_series?: string
        }
        Returns: {
          amount_net: number
          amount_tax: number
          amount_total: number
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string
          currency_code: string
          description: string | null
          direction: string
          doc_type: Database["public"]["Enums"]["document_type"]
          due_date: string | null
          id: string
          is_opening: boolean
          issue_date: string
          legal_entity_id: string
          organization_id: string
          quote_version_id: string | null
          series_number: string | null
          status: Database["public"]["Enums"]["document_status"]
          supplier_id: string | null
          tax_rate: number | null
          updated_at: string
          void_reason: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "billing_documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      guardar_cronograma: {
        Args: { p_items: Json; p_quote: string }
        Returns: {
          amount: number
          billing_document_id: string | null
          created_at: string
          currency_code: string
          direction: string
          due_date: string
          expected_cash_account_id: string | null
          id: string
          label: string
          legal_entity_id: string
          organization_id: string
          quote_id: string | null
          quote_version_id: string | null
          sort: number
          status: Database["public"]["Enums"]["schedule_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "payment_schedule_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      guardar_gasto_recurrente: {
        Args: {
          p_account?: string
          p_amount: number
          p_cadence?: Database["public"]["Enums"]["recurrence"]
          p_category?: string
          p_cost_item?: string
          p_currency: string
          p_day?: number
          p_ends_on?: string
          p_entity: string
          p_id?: string
          p_label: string
          p_notes?: string
          p_starts_on?: string
        }
        Returns: {
          amount: number
          cadence: Database["public"]["Enums"]["recurrence"]
          cash_account_id: string | null
          category_id: string | null
          cost_item_id: string | null
          created_at: string
          created_by: string
          currency_code: string
          day_of_month: number | null
          ends_on: string | null
          id: string
          is_active: boolean
          label: string
          legal_entity_id: string
          notes: string | null
          organization_id: string
          starts_on: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "recurring_expenses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      next_quote_number: { Args: { p_entity: string }; Returns: string }
      recalc_quote_line_price: { Args: { p_line: string }; Returns: number }
      registrar_cobro: {
        Args: {
          p_account: string
          p_amount: number
          p_description?: string
          p_document: string
          p_external_ref?: string
          p_value_date?: string
        }
        Returns: {
          amount: number
          amount_net: number | null
          amount_tax: number | null
          booked_at: string
          cash_account_id: string
          category_id: string | null
          client_id: string | null
          counterparty_kind: string | null
          created_at: string
          created_by: string
          currency_code: string
          description: string
          direction: Database["public"]["Enums"]["cash_direction"]
          external_ref: string | null
          flow_class: Database["public"]["Enums"]["flow_class"]
          id: string
          is_void: boolean
          kind: Database["public"]["Enums"]["cash_kind"]
          legal_entity_id: string
          organization_id: string
          recurring_expense_id: string | null
          source: string
          supplier_id: string | null
          transfer_id: string | null
          value_date: string
          void_reason: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "cash_movements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      registrar_compra: {
        Args: {
          p_amount: number
          p_category?: string
          p_currency: string
          p_description?: string
          p_doc_type?: Database["public"]["Enums"]["document_type"]
          p_due_date?: string
          p_entity: string
          p_issue_date?: string
          p_series?: string
          p_supplier: string
          p_tax_rate?: number
        }
        Returns: {
          amount_net: number
          amount_tax: number
          amount_total: number
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string
          currency_code: string
          description: string | null
          direction: string
          doc_type: Database["public"]["Enums"]["document_type"]
          due_date: string | null
          id: string
          is_opening: boolean
          issue_date: string
          legal_entity_id: string
          organization_id: string
          quote_version_id: string | null
          series_number: string | null
          status: Database["public"]["Enums"]["document_status"]
          supplier_id: string | null
          tax_rate: number | null
          updated_at: string
          void_reason: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "billing_documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      registrar_movimiento: {
        Args: {
          p_account: string
          p_amount: number
          p_amount_net?: number
          p_amount_tax?: number
          p_category?: string
          p_client?: string
          p_description: string
          p_direction: Database["public"]["Enums"]["cash_direction"]
          p_external_ref?: string
          p_kind?: Database["public"]["Enums"]["cash_kind"]
          p_recurring?: string
          p_value_date?: string
        }
        Returns: {
          amount: number
          amount_net: number | null
          amount_tax: number | null
          booked_at: string
          cash_account_id: string
          category_id: string | null
          client_id: string | null
          counterparty_kind: string | null
          created_at: string
          created_by: string
          currency_code: string
          description: string
          direction: Database["public"]["Enums"]["cash_direction"]
          external_ref: string | null
          flow_class: Database["public"]["Enums"]["flow_class"]
          id: string
          is_void: boolean
          kind: Database["public"]["Enums"]["cash_kind"]
          legal_entity_id: string
          organization_id: string
          recurring_expense_id: string | null
          source: string
          supplier_id: string | null
          transfer_id: string | null
          value_date: string
          void_reason: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "cash_movements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      registrar_pago_de_compra: {
        Args: {
          p_account: string
          p_amount: number
          p_description?: string
          p_document: string
          p_external_ref?: string
          p_value_date?: string
        }
        Returns: {
          amount: number
          amount_net: number | null
          amount_tax: number | null
          booked_at: string
          cash_account_id: string
          category_id: string | null
          client_id: string | null
          counterparty_kind: string | null
          created_at: string
          created_by: string
          currency_code: string
          description: string
          direction: Database["public"]["Enums"]["cash_direction"]
          external_ref: string | null
          flow_class: Database["public"]["Enums"]["flow_class"]
          id: string
          is_void: boolean
          kind: Database["public"]["Enums"]["cash_kind"]
          legal_entity_id: string
          organization_id: string
          recurring_expense_id: string | null
          source: string
          supplier_id: string | null
          transfer_id: string | null
          value_date: string
          void_reason: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "cash_movements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      registrar_transferencia: {
        Args: {
          p_amount_from: number
          p_amount_to?: number
          p_description?: string
          p_external_ref?: string
          p_fee?: number
          p_fee_account?: string
          p_from: string
          p_to: string
          p_value_date?: string
        }
        Returns: {
          amount_from: number
          amount_to: number
          created_at: string
          created_by: string
          currency_from: string
          currency_to: string
          description: string
          external_ref: string | null
          fee_account_id: string | null
          fee_amount: number | null
          from_account_id: string
          fx_rate: number | null
          id: string
          legal_entity_id: string
          organization_id: string
          to_account_id: string
          value_date: string
        }[]
        SetofOptions: {
          from: "*"
          to: "transfers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_quote_design: {
        Args: { p_patch: Json; p_quote: string }
        Returns: Json
      }
    }
    Enums: {
      account_kind: "bank" | "cash" | "wallet" | "card"
      cash_direction: "in" | "out"
      cash_kind:
        | "operating"
        | "transfer"
        | "opening"
        | "owner_draw"
        | "owner_contribution"
        | "loan_in"
        | "loan_repayment"
        | "bank_fee"
        | "tax_payment"
        | "fx_adjustment"
        | "refund"
      category_direction: "in" | "out" | "both"
      cost_item_kind: "role" | "tool" | "external" | "other"
      document_status: "draft" | "open" | "partially_paid" | "paid" | "void"
      document_type:
        | "invoice"
        | "boleta"
        | "receipt"
        | "note"
        | "credit_note"
        | "other"
      flow_class: "operating" | "non_operating" | "internal_transfer" | "opening"
      fx_rate_kind: "closing" | "official" | "manual"
      membership_role: "owner" | "admin" | "finance" | "commercial" | "viewer"
      membership_status: "invited" | "active" | "suspended"
      quote_status:
        | "draft"
        | "sent"
        | "negotiation"
        | "approved"
        | "rejected"
        | "expired"
        | "void"
      recurrence: "weekly" | "monthly" | "quarterly" | "yearly"
      schedule_status: "planned" | "documented" | "settled" | "cancelled"
      service_kind: "one_off" | "recurring" | "retainer"
      term_kind: "include" | "exclude" | "condition" | "note"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_kind: ["bank", "cash", "wallet", "card"],
      cash_direction: ["in", "out"],
      cash_kind: [
        "operating",
        "transfer",
        "opening",
        "owner_draw",
        "owner_contribution",
        "loan_in",
        "loan_repayment",
        "bank_fee",
        "tax_payment",
        "fx_adjustment",
        "refund",
      ],
      category_direction: ["in", "out", "both"],
      cost_item_kind: ["role", "tool", "external", "other"],
      document_status: ["draft", "open", "partially_paid", "paid", "void"],
      document_type: [
        "invoice",
        "boleta",
        "receipt",
        "note",
        "credit_note",
        "other",
      ],
      flow_class: ["operating", "non_operating", "internal_transfer", "opening"],
      fx_rate_kind: ["closing", "official", "manual"],
      membership_role: ["owner", "admin", "finance", "commercial", "viewer"],
      membership_status: ["invited", "active", "suspended"],
      quote_status: [
        "draft",
        "sent",
        "negotiation",
        "approved",
        "rejected",
        "expired",
        "void",
      ],
      recurrence: ["weekly", "monthly", "quarterly", "yearly"],
      schedule_status: ["planned", "documented", "settled", "cancelled"],
      service_kind: ["one_off", "recurring", "retainer"],
      term_kind: ["include", "exclude", "condition", "note"],
    },
  },
} as const
