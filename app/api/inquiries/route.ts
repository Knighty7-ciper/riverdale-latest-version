import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
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

const InquirySchema = z.object({
  packageId: z.string().min(1),
  packageName: z.string().min(1),
  packagePrice: z.number().nonnegative(),
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(5),
  travelDate: z.string().optional().nullable(),
  groupSize: z.string().optional().nullable(),
  specialRequests: z.string().optional().nullable(),
})

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 })
  }

  try {
    const json = await req.json()
    const parsed = InquirySchema.safeParse(json)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 })
    }

    const {
      packageId,
      packageName,
      packagePrice,
      name,
      email,
      phone,
      travelDate,
      groupSize,
      specialRequests,
    } = parsed.data

    const now = new Date()
    const verificationId = `RVD-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(
      1000 + Math.random() * 9000,
    )}`

    // Basic dedupe: check for an inquiry from the same email for the same package in the last 15 minutes
    const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
    const { data: existing, error: checkError } = await supabase
      .from("inquiries")
      .select("id, verification_id")
      .eq("customer_email", email)
      .eq("package_id", packageId)
      .gte("created_at", fifteenMinsAgo)
      .limit(1)

    if (checkError) {
      console.error("Error checking duplicates:", checkError)
    }

    if (existing && existing.length > 0) {
      return NextResponse.json(
        {
          success: true,
          message: "Duplicate inquiry detected; using existing verification.",
          verificationId: existing[0].verification_id,
        },
        { status: 200 },
      )
    }

    const { data, error } = await supabase
      .from("inquiries")
      .insert([
        {
          verification_id: verificationId,
          customer_name: name,
          customer_email: email,
          customer_phone: phone,
          package_id: packageId,
          package_name: packageName,
          package_price: packagePrice,
          preferred_start_date: travelDate || null,
          group_size: groupSize ? Number.parseInt(groupSize) : null,
          special_requests: specialRequests || null,
          inquiry_status: "pending",
          created_at: now.toISOString(),
        },
      ])
      .select()
      .single()

    if (error) {
      console.error("Error creating inquiry:", error)
      return NextResponse.json({ error: "Failed to create inquiry" }, { status: 500 })
    }

    // Fire-and-forget notification (do not block response)
    try {
      const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || ""
      const url = origin ? `${origin}/api/send-inquiry-notification` : "/api/send-inquiry-notification"
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationId,
          customerName: name,
          customerEmail: email,
          customerPhone: phone,
          packageName,
          packagePrice,
          travelDate,
          groupSize,
          specialRequests,
          adminEmail: "bknglabs.dev@gmail.com",
        }),
      })
    } catch (e) {
      console.error("Notification dispatch failed:", e)
    }

    return NextResponse.json({ success: true, verificationId })
  } catch (e) {
    console.error("Unhandled error in inquiry creation:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
