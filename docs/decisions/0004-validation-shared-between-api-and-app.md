# 4. Shape validation in a shared package, rules in the use cases

Date: 2026-11-12

## Context

A member fills in a payout form on the phone; a manager creates an offer in the back office. The API has to refuse a bad request, and the form should refuse it first, with the same words, so nobody fills in a form only to be told afterwards. There are two kinds of "bad": a body of the wrong shape (a string where cents are expected, an unknown payout method, a date that is not a date) and a request that is well formed but breaks a business rule (a transfer under 20 €, a boost that overlaps another, a claim three months late).

## Options considered

1. **Validate everything in the route handlers** with Fastify's JSON Schema. Fast, but the app cannot import JSON Schema as a form validator without a second library, and the rules would be split between the schema and the handler.
2. **Everything in the domain**, including the shape checks, with the API passing raw bodies through. The domain would have to know about strings-that-should-be-dates and query strings, which is HTTP's business, and would need a parsing library it otherwise has no use for.
3. **Two layers.** `packages/contracts` holds zod schemas for every request body and query: shape, types, enums, coercion from query strings, page limits. The API parses with them; the app's forms validate with the same objects. The business rules stay in the use cases, which return `invalid`, `rule` or `conflict` as values, mapped to 400, 422 or 409.

## Decision

Option 3. The contract for a request is one zod object, imported by both ends. A 400 means the request could not be read; a 422 means it was read and refused by a rule; a 409 means the entity is not in a state that allows it. Where a shape rule is also a domain rule (the password rule), the schema calls the domain function, so the words are the same.

## Consequences

One more package, and the use cases still re-check what matters (a negative amount, a blank reason) because they are also called from the browser demo without the HTTP layer in front. The rule errors arrive from the API with a message the form can show as-is. The app has to show two kinds of error: field problems before sending, and rule problems after; the screens are designed for both.
