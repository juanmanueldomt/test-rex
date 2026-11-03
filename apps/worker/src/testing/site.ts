// A tiny web application for browser tests: sign-in with a cookie, a cart with a coupon that
// applies after a delay, repeated buttons, a checkbox, a select and a page with console errors.
import { createServer, type Server } from 'node:http';

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;margin:24px} li{margin:8px 0} input,select,button{margin:4px}</style>
</head><body>${body}</body></html>`;

const PAGES: Record<string, (cookie: string) => string> = {
  '/': () => page('Shop', '<h1>Shop</h1><a href="/login">Sign in</a> <a href="/cart">Cart</a>'),
  '/login': () =>
    page(
      'Sign in',
      `<h1>Sign in</h1>
<form id="f">
  <label>Email <input name="email" type="email"></label><br>
  <label for="pw">Password</label> <input id="pw" type="password"><br>
  <button type="submit">Sign in</button>
</form>
<script>
f.onsubmit = (event) => {
  event.preventDefault();
  document.cookie = 'session=' + encodeURIComponent(f.email.value) + '; path=/';
  location.href = '/account';
};
</script>`,
    ),
  '/account': (cookie) => {
    const match = /(?:^|;\s*)session=([^;]+)/.exec(cookie);
    const user = match ? decodeURIComponent(match[1]!) : null;
    return page('Account', user ? `<h1>Welcome ${user}</h1>` : '<h1>Please sign in</h1>');
  },
  '/cart': () =>
    page(
      'Cart',
      `<h1>Cart</h1>
<label>Coupon <input id="coupon" placeholder="Coupon code"></label>
<button id="apply">Apply</button>
<p>Total: <span data-testid="total">100</span></p>
<p id="msg" role="status" style="min-height:1.5em"></p>
<label><input type="checkbox" id="gift"> Gift wrap</label><br>
<label>Country <select id="country"><option value="es">Spain</option><option value="ar">Argentina</option></select></label>
<ul>
  <li>Book <button>Remove</button></li>
  <li>Pen <button>Remove</button></li>
  <li>Mug <button>Remove</button></li>
</ul>
<button disabled>Pay later</button>
<script>
apply.onclick = () => setTimeout(() => {
  if (coupon.value === 'SAVE10') {
    document.querySelector('[data-testid=total]').textContent = '90';
    msg.textContent = 'Discount applied';
  } else {
    msg.textContent = 'Invalid coupon';
  }
}, 300);
document.querySelectorAll('li button').forEach((button) => {
  button.onclick = () => button.closest('li').remove();
});
</script>`,
    ),
  '/broken': () => page('Broken', '<h1>Broken</h1><script>console.error("boom")</script>'),
};

export interface FixtureSite {
  url: string;
  close(): Promise<void>;
}

export async function startSite(): Promise<FixtureSite> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    const render = PAGES[path];
    if (!render) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(render(req.headers.cookie ?? ''));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
