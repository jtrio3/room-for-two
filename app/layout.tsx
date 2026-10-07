import type { Metadata } from 'next';
import './globals.css';
import './groups.css';
import './purchases.css';
export const metadata: Metadata = {title:'Room for Two · Home shopping planner',description:'Plan your November move together. Prioritize the essentials, compare Black Friday prices, and make room in your budget.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'},referrer:'no-referrer',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
