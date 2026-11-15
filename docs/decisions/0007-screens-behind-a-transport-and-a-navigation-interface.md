# 7. Screens talk to a transport and a navigation interface, never to the router or to fetch

Date: 2026-11-15

## Context

The app has to run three ways: on a phone against the API, in a browser against the API, and in a browser with no API at all, where the same use cases run on PGlite (demo mode). The screens are the same in all three. They also have to be tested as components, in the same test runner as the rest of the workspace, without a device, a server or the router's native navigation container.

## Options considered

1. **Screens call `fetch` and the router directly.** The shortest code. Demo mode would then need a service worker or a patched `fetch` to answer requests that never leave the browser, and a component test would need to mock the router module and `fetch` globally.
2. **A data layer of hooks over a client, and the router behind an interface.** Each screen asks `useOffers`, `useWallet`, `useRequestPayout` and so on; the hooks use one client; the client uses a transport (`request(method, path, query, body, token)`). HTTP is one transport; demo mode is another that maps the same method and path to the use cases in the browser. Navigation is `push`, `replace`, `back` and a `Link` component behind an interface the root layout implements with the router and the tests implement with an array.
3. **A GraphQL or tRPC layer** that would give typed calls for free. Neither is in the company's stack, and both would be a second description of an API that already has zod contracts.

## Decision

Option 2. The composition root of the app (`src/deps.ts` and `src/app-context.tsx`) decides the transport and the navigation once; the screens receive them through context. A screen imports nothing from `expo-router` and never calls `fetch`. The tests render the real screens with react-native-web in jsdom against a fake transport, which is a table of `METHOD /path` handlers answering with fixture rows or with the API's own error shape, and check what the screen sent and where it wanted to go.

The client turns the API's `{ error: { code, message, details } }` into one `ApiError`. A form validates with the schema from `packages/contracts` before sending and shows the API's own message when a rule refuses the request after, so the two ends keep agreeing (decision 4).

## Consequences

Demo mode in the next session is a second transport and nothing else in the app changes. The route files under `src/app/` are one line each and are not tested; everything that matters is in `src/screens/`, which is. The cost is an interface to keep in step with the router's features: deep links and the back stack go through it, and anything the router can do that the interface does not name is not available to a screen until it is added.
