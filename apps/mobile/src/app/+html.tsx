import { ScrollViewStyleReset, useServerDocumentContext } from "expo-router/html";
import type { PropsWithChildren } from "react";

/**
 * The HTML shell of the web export, one document for every route. The router hands over the nodes
 * it needs in the head (styles, preloads) and at the end of the body (the bundle scripts); a shell
 * that leaves them out exports pages that never run.
 */
export default function Root({ children }: PropsWithChildren) {
  const { htmlAttributes, headNodes, bodyAttributes, bodyNodes } = useServerDocumentContext();
  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>Cagnotte</title>
        <meta name="description" content="Cashback on the shops you already use, in a pot you can pay out." />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
