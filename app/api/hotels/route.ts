import { NextResponse, type NextRequest } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

const isConfigured =
  typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL.length > 0 &&
  typeof process.env.SUPABASE_SERVICE_ROLE_KEY === "string" &&
  process.env.SUPABASE_SERVICE_ROLE_KEY.length > 0

const supabase = isConfigured
  ? createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  : null

export async function GET(req: NextRequest) {
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 })

  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get("search")?.trim()
    const category = searchParams.get("category")?.trim()
    const featured = searchParams.get("featured")?.trim()
    const limit = Number.parseInt(searchParams.get("limit") || "60")

    let query = supabase.from("hotels").select("*").order("created_at", { ascending: false })

    if (search) {
      const like = `%${search}%`
      query = query.or(
        `name.ilike.${like},description.ilike.${like},location.ilike.${like},country.ilike.${like},category.ilike.${like}`,
      )
    }

    if (category && category !== "all") query = query.eq("category", category)
    if (featured === "true") query = query.eq("featured", true)
    if (Number.isFinite(limit)) query = query.limit(limit)

    const { data, error } = await query
    if (error) {
      console.error("Error fetching hotels:", error)
      return NextResponse.json({ error: "Failed to fetch hotels" }, { status: 500 })
    }

    const rows = (data || []).map((h: any) => ({
      id: h.id,
      name: h.name,
      description: h.description || "",
      location: h.location || h.country || "",
      price_per_night: h.price_per_night ?? 0,
      rating: h.rating ?? 0,
      reviews_count: h.reviews_count ?? 0,
      image_url: h.image_url || "/placeholder.svg",
      category: h.category || "",
      amenities: h.amenities || [],
      featured: Boolean(h.featured),
      created_at: h.created_at,
    }))

    return NextResponse.json({ hotels: rows })
  } catch (e) {
    console.error("Unhandled hotels GET:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
