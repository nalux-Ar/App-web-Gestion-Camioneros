// Generado con el MCP de Supabase (generate_typescript_types) sobre el
// proyecto de Supabase del repo, después de las migraciones 001–010.
// No editar a mano: regenerar cuando cambie el esquema.

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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      camiones: {
        Row: {
          activa: boolean
          anio: number | null
          created_at: string
          id: string
          marca: string | null
          modelo: string | null
          patente: string
          transportista_id: string
          updated_at: string
        }
        Insert: {
          activa?: boolean
          anio?: number | null
          created_at?: string
          id?: string
          marca?: string | null
          modelo?: string | null
          patente: string
          transportista_id: string
          updated_at?: string
        }
        Update: {
          activa?: boolean
          anio?: number | null
          created_at?: string
          id?: string
          marca?: string | null
          modelo?: string | null
          patente?: string
          transportista_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "camiones_transportista_id_fkey"
            columns: ["transportista_id"]
            isOneToOne: false
            referencedRelation: "transportistas"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_gasto: {
        Row: {
          activa: boolean
          created_at: string
          id: string
          nombre: string
          transportista_id: string | null
          updated_at: string
        }
        Insert: {
          activa?: boolean
          created_at?: string
          id?: string
          nombre: string
          transportista_id?: string | null
          updated_at?: string
        }
        Update: {
          activa?: boolean
          created_at?: string
          id?: string
          nombre?: string
          transportista_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_gasto_transportista_id_fkey"
            columns: ["transportista_id"]
            isOneToOne: false
            referencedRelation: "transportistas"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          client_ref: string | null
          contacto_email: string | null
          contacto_telefono: string | null
          created_at: string
          direccion: string | null
          id: string
          nombre: string
          transportista_id: string
          updated_at: string
        }
        Insert: {
          client_ref?: string | null
          contacto_email?: string | null
          contacto_telefono?: string | null
          created_at?: string
          direccion?: string | null
          id?: string
          nombre: string
          transportista_id: string
          updated_at?: string
        }
        Update: {
          client_ref?: string | null
          contacto_email?: string | null
          contacto_telefono?: string | null
          created_at?: string
          direccion?: string | null
          id?: string
          nombre?: string
          transportista_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_transportista_id_fkey"
            columns: ["transportista_id"]
            isOneToOne: false
            referencedRelation: "transportistas"
            referencedColumns: ["id"]
          },
        ]
      }
      devoluciones: {
        Row: {
          client_ref: string | null
          cliente_id: string
          created_at: string
          descripcion: string | null
          id: string
          motivo: Database["public"]["Enums"]["motivo_devolucion"]
          transportista_id: string
          updated_at: string
          viaje_id: string
        }
        Insert: {
          client_ref?: string | null
          cliente_id: string
          created_at?: string
          descripcion?: string | null
          id?: string
          motivo: Database["public"]["Enums"]["motivo_devolucion"]
          transportista_id: string
          updated_at?: string
          viaje_id: string
        }
        Update: {
          client_ref?: string | null
          cliente_id?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          motivo?: Database["public"]["Enums"]["motivo_devolucion"]
          transportista_id?: string
          updated_at?: string
          viaje_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devoluciones_cliente_fk"
            columns: ["transportista_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["transportista_id", "id"]
          },
          {
            foreignKeyName: "devoluciones_transportista_id_fkey"
            columns: ["transportista_id"]
            isOneToOne: false
            referencedRelation: "transportistas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_viaje_fk"
            columns: ["transportista_id", "viaje_id"]
            isOneToOne: false
            referencedRelation: "viajes"
            referencedColumns: ["transportista_id", "id"]
          },
        ]
      }
      entregas: {
        Row: {
          cliente_id: string
          created_at: string
          id: string
          incidencias: string | null
          transportista_id: string
          updated_at: string
          viaje_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          id?: string
          incidencias?: string | null
          transportista_id: string
          updated_at?: string
          viaje_id: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          id?: string
          incidencias?: string | null
          transportista_id?: string
          updated_at?: string
          viaje_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entregas_cliente_fk"
            columns: ["transportista_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["transportista_id", "id"]
          },
          {
            foreignKeyName: "entregas_transportista_id_fkey"
            columns: ["transportista_id"]
            isOneToOne: false
            referencedRelation: "transportistas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_viaje_fk"
            columns: ["transportista_id", "viaje_id"]
            isOneToOne: false
            referencedRelation: "viajes"
            referencedColumns: ["transportista_id", "id"]
          },
        ]
      }
      gastos: {
        Row: {
          camion_id: string | null
          categoria_id: string
          client_ref: string | null
          created_at: string
          descripcion: string | null
          fecha: string
          foto_url: string | null
          id: string
          km_odometro: number | null
          litros: number | null
          metodo_pago: Database["public"]["Enums"]["metodo_pago"] | null
          monto: number
          precio_por_litro: number | null
          tanque_lleno: boolean | null
          transportista_id: string
          updated_at: string
          viaje_id: string | null
        }
        Insert: {
          camion_id?: string | null
          categoria_id: string
          client_ref?: string | null
          created_at?: string
          descripcion?: string | null
          fecha?: string
          foto_url?: string | null
          id?: string
          km_odometro?: number | null
          litros?: number | null
          metodo_pago?: Database["public"]["Enums"]["metodo_pago"] | null
          monto: number
          precio_por_litro?: number | null
          tanque_lleno?: boolean | null
          transportista_id: string
          updated_at?: string
          viaje_id?: string | null
        }
        Update: {
          camion_id?: string | null
          categoria_id?: string
          client_ref?: string | null
          created_at?: string
          descripcion?: string | null
          fecha?: string
          foto_url?: string | null
          id?: string
          km_odometro?: number | null
          litros?: number | null
          metodo_pago?: Database["public"]["Enums"]["metodo_pago"] | null
          monto?: number
          precio_por_litro?: number | null
          tanque_lleno?: boolean | null
          transportista_id?: string
          updated_at?: string
          viaje_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gastos_camion_fk"
            columns: ["transportista_id", "camion_id"]
            isOneToOne: false
            referencedRelation: "camiones"
            referencedColumns: ["transportista_id", "id"]
          },
          {
            foreignKeyName: "gastos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_gasto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_transportista_id_fkey"
            columns: ["transportista_id"]
            isOneToOne: false
            referencedRelation: "transportistas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_viaje_fk"
            columns: ["transportista_id", "viaje_id"]
            isOneToOne: false
            referencedRelation: "viajes"
            referencedColumns: ["transportista_id", "id"]
          },
        ]
      }
      miembros: {
        Row: {
          color_acento: string
          created_at: string
          id: string
          rol: Database["public"]["Enums"]["rol_miembro"]
          tema: string
          transportista_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color_acento?: string
          created_at?: string
          id?: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          tema?: string
          transportista_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color_acento?: string
          created_at?: string
          id?: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          tema?: string
          transportista_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "miembros_transportista_id_fkey"
            columns: ["transportista_id"]
            isOneToOne: false
            referencedRelation: "transportistas"
            referencedColumns: ["id"]
          },
        ]
      }
      transportistas: {
        Row: {
          created_at: string
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: []
      }
      viajes: {
        Row: {
          camion_id: string | null
          client_ref: string | null
          created_at: string
          destino: string
          fecha: string
          id: string
          ingreso: number | null
          km_final: number | null
          km_inicial: number | null
          km_recorridos: number | null
          observaciones: string | null
          origen: string
          transportista_id: string
          updated_at: string
        }
        Insert: {
          camion_id?: string | null
          client_ref?: string | null
          created_at?: string
          destino: string
          fecha?: string
          id?: string
          ingreso?: number | null
          km_final?: number | null
          km_inicial?: number | null
          km_recorridos?: number | null
          observaciones?: string | null
          origen: string
          transportista_id: string
          updated_at?: string
        }
        Update: {
          camion_id?: string | null
          client_ref?: string | null
          created_at?: string
          destino?: string
          fecha?: string
          id?: string
          ingreso?: number | null
          km_final?: number | null
          km_inicial?: number | null
          km_recorridos?: number | null
          observaciones?: string | null
          origen?: string
          transportista_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "viajes_camion_fk"
            columns: ["transportista_id", "camion_id"]
            isOneToOne: false
            referencedRelation: "camiones"
            referencedColumns: ["transportista_id", "id"]
          },
          {
            foreignKeyName: "viajes_transportista_id_fkey"
            columns: ["transportista_id"]
            isOneToOne: false
            referencedRelation: "transportistas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      actualizar_viaje_con_entregas: {
        Args: {
          p_camion_id: string
          p_destino: string
          p_entregas: Json
          p_fecha: string
          p_ingreso: number
          p_km_final: number
          p_km_inicial: number
          p_km_recorridos: number
          p_observaciones: string
          p_origen: string
          p_viaje_id: string
        }
        Returns: undefined
      }
      cambiar_rol_miembro: {
        Args: {
          p_rol: Database["public"]["Enums"]["rol_miembro"]
          p_user_id: string
        }
        Returns: undefined
      }
      crear_camion: {
        Args: {
          p_anio?: number
          p_marca?: string
          p_modelo?: string
          p_patente: string
        }
        Returns: {
          activa: boolean
          camion_id: string
          creado: boolean
          gastos_asignados: number
          viajes_asignados: number
        }[]
      }
      crear_viaje_con_entregas: {
        Args: {
          p_camion_id?: string
          p_client_ref: string
          p_destino: string
          p_entregas?: Json
          p_fecha: string
          p_ingreso?: number
          p_km_final?: number
          p_km_inicial?: number
          p_km_recorridos?: number
          p_observaciones?: string
          p_origen: string
        }
        Returns: {
          creado: boolean
          viaje_id: string
        }[]
      }
      create_transportista: { Args: { p_nombre: string }; Returns: string }
      get_mi_transportista_id: { Args: never; Returns: string }
    }
    Enums: {
      metodo_pago:
        | "efectivo"
        | "tarjeta_credito"
        | "tarjeta_debito"
        | "transferencia"
      motivo_devolucion:
        | "rotura_danio"
        | "vencimiento"
        | "mercaderia_incorrecta"
        | "otro"
      rol_miembro: "admin" | "chofer"
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
      metodo_pago: [
        "efectivo",
        "tarjeta_credito",
        "tarjeta_debito",
        "transferencia",
      ],
      motivo_devolucion: [
        "rotura_danio",
        "vencimiento",
        "mercaderia_incorrecta",
        "otro",
      ],
      rol_miembro: ["admin", "chofer"],
    },
  },
} as const
