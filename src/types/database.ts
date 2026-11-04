// Generado desde el proyecto real con `npm run db:types`. No editar a mano.
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
      brands: {
        Row: {
          accent_color: string | null
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
      quotes: {
        Row: {
          brand_id: string | null
          client_id: string
          created_at: string
          currency_code: string
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
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_organization: {
        Args: { p_currency?: string; p_name: string }
        Returns: string
      }
      add_quote_line_from_service: {
        Args: { p_quantity?: number; p_quote: string; p_service: string }
        Returns: string
      }
      next_quote_number: {
        Args: { p_entity: string }
        Returns: string
      }
      recalc_quote_line_price: {
        Args: { p_line: string }
        Returns: number
      }
    }
    Enums: {
      account_kind: "bank" | "cash" | "wallet" | "card"
      category_direction: "in" | "out" | "both"
      cost_item_kind: "role" | "tool" | "external" | "other"
      fx_rate_kind: "closing" | "official" | "manual"
      membership_role: "owner" | "admin" | "finance" | "commercial" | "viewer"
      membership_status: "invited" | "active" | "suspended"
      quote_status:
        | "draft"
        | "sent"
        | "approved"
        | "rejected"
        | "expired"
        | "void"
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
      category_direction: ["in", "out", "both"],
      cost_item_kind: ["role", "tool", "external", "other"],
      fx_rate_kind: ["closing", "official", "manual"],
      membership_role: ["owner", "admin", "finance", "commercial", "viewer"],
      membership_status: ["invited", "active", "suspended"],
      quote_status: ["draft", "sent", "approved", "rejected", "expired", "void"],
      service_kind: ["one_off", "recurring", "retainer"],
      term_kind: ["include", "exclude", "condition", "note"],
    },
  },
} as const
