// Privy wallet connection for Quoro's vanilla site: the person connects a wallet they already have (no email, no new wallets).
// Mounts once and publishes its state on window.QuoroPrivy plus a 'quoro-privy' event; site/js/wallet.js does the rest.
// The page sets window.PRIVY_APP_ID from /api/config before loading this file.
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { robinhood, mainnet, base, arbitrum, optimism, bsc, polygon, unichain, linea, zksync, scroll, blast, ink, worldchain, soneium, abstract, mode } from 'viem/chains';

function Bridge() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  // the wallet the person signed in with; with email, the Privy wallet made for them
  const own = user?.wallet?.address?.toLowerCase();
  const wallet = wallets.find(w => w.address.toLowerCase() === own) || wallets.find(w => w.walletClientType === 'privy') || wallets[0] || null;
  useEffect(() => {
    window.QuoroPrivy = {
      ready, authenticated, login, logout,
      address: authenticated && wallet ? wallet.address : null,
      label: user?.email?.address || null,
      embedded: wallet?.walletClientType === 'privy',
      provider: () => wallet.getEthereumProvider(),
      switchChain: id => wallet.switchChain(id),
    };
    window.dispatchEvent(new CustomEvent('quoro-privy', { detail: window.QuoroPrivy }));
  }, [ready, authenticated, user, wallet]);
  return null;
}

// the sign-in window in Quoro's colours (dark like the site; Robinhood Chain lime #ccff00 marks the action)
const brand = document.createElement('style');
brand.textContent = `#privy-dialog,#privy-modal-content{--privy-border-radius-sm:10px !important;--privy-border-radius-md:14px !important;--privy-border-radius-mdlg:18px !important;--privy-border-radius-lg:24px !important;--privy-border-radius-full:9999px !important;--privy-color-background:#1b1b1b !important;--privy-color-background-2:#232323 !important;--privy-color-background-3:#2d2d2d !important;--privy-color-foreground:#ffffff !important;--privy-color-foreground-2:#e6e6e6 !important;--privy-color-foreground-3:#9b9b9b !important;--privy-color-foreground-4:#6b6b6b !important;--privy-color-foreground-accent:#131313 !important;--privy-color-accent:#ccff00 !important;--privy-color-accent-light:#dbff4d !important;--privy-color-accent-lightest:#2a3300 !important;--privy-color-accent-dark:#b3e000 !important;--privy-color-accent-darkest:#4d6100 !important;--privy-color-success:#40b66b !important;--privy-color-error:#ff5f52 !important;--privy-color-error-light:#2e1513 !important}
#privy-dialog,#privy-modal-content{font-family:Inter,ui-sans-serif,system-ui,sans-serif}`;
document.head.appendChild(brand);

const el = document.createElement('div');
el.id = 'privy-root';
document.body.appendChild(el);
createRoot(el).render(
  <PrivyProvider appId={window.PRIVY_APP_ID} config={{
    loginMethods: ['wallet'],
    appearance: { theme: '#1b1b1b', accentColor: '#ccff00', logo: location.origin + '/assets/privy-logo.png',
                  landingHeader: 'Connect a wallet',
                  loginMessage: 'Use the wallet you already have. Quoro never holds your money.',
                  walletChainType: 'ethereum-only' },
    embeddedWallets: { ethereum: { createOnLogin: 'off' } },
    defaultChain: robinhood,
    // every chain the pay side can spend from (server.py CHAINS): the wallet switches to it before signing
    supportedChains: [robinhood, mainnet, base, arbitrum, optimism, bsc, polygon, unichain, linea, zksync, scroll, blast, ink, worldchain, soneium, abstract, mode],
  }}><Bridge /></PrivyProvider>
);
