import { describe, expect, it } from "vitest"
import { getAllPosts, getPostBySlug } from "./posts"

describe("post loading", () => {
  it("returns posts sorted by descending date", async () => {
    const posts = await getAllPosts()

    expect(posts.map((post) => post.slug)).toEqual(["mdx-notes", "hello-world"])
  })

  it("reads frontmatter and raw source for a post", async () => {
    const post = await getPostBySlug("hello-world")

    expect(post).not.toBeNull()
    expect(post?.title).toBe("Hello World")
    expect(post?.summary).toBe("The first post in the template.")
    expect(post?.source).toContain("# Hello World")
  })
})
