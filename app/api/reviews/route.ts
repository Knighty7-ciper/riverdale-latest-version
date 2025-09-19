import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const packageId = searchParams.get("package_id")
    const limit = searchParams.get("limit")
    const featured = searchParams.get("featured")

    let query = supabase
      .from("customer_reviews")
      .select(`
        *,
        packages (
          name,
          slug,
          destinations (
            name,
            countries (
              name
            )
          )
        )
      `)
      .eq("admin_approved", true)
      .order("created_at", { ascending: false })

    if (packageId) {
      query = query.eq("package_id", packageId)
    }

    if (featured === "true") {
      query = query.eq("featured", true)
    }

    if (limit) {
      query = query.limit(Number.parseInt(limit))
    }

    const { data: reviews, error } = await query

    if (error) {
      console.error("Error fetching reviews:", error)
      return NextResponse.json({ error: "Failed to fetch reviews" }, { status: 500 })
    }

    return NextResponse.json({ reviews })
  } catch (error) {
    console.error("Error in reviews API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { package_id, customer_name, customer_email, customer_location, title, content, rating, travel_date } = body

    // Validate required fields
    if (!customer_name || !customer_email || !title || !content || !rating) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Validate rating
    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Rating must be between 1 and 5" }, { status: 400 })
    }

    // Insert review (will need admin approval)
    const { data: review, error } = await supabase
      .from("customer_reviews")
      .insert({
        package_id,
        customer_name,
        customer_email,
        customer_location,
        title,
        content,
        rating,
        travel_date,
        admin_approved: false, // Requires admin approval
        verified: false,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating review:", error)
      return NextResponse.json({ error: "Failed to create review" }, { status: 500 })
    }

    // Create admin notification
    await supabase.from("notification_queue").insert({
      notification_type: "new_review",
      recipient_email: "bknglabs.dev@gmail.com",
      title: "New Customer Review Submitted",
      message: `A new review has been submitted by ${customer_name} for approval.`,
      review_id: review.id,
    })

    return NextResponse.json({
      message: "Review submitted successfully and is pending approval",
      review,
    })
  } catch (error) {
    console.error("Error in reviews POST API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
