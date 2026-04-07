import { useState, useCallback } from 'react';
import { useSignIn, useSignUp } from '@clerk/clerk-react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

type Mode = 'signin' | 'signup' | 'forgot';

export default function AuthPage() {
  const { signIn, isLoaded: signInLoaded, setActive } = useSignIn();
  const { signUp, isLoaded: signUpLoaded } = useSignUp();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [pendingVerification, setPendingVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');

  const handleSignIn = useCallback(async () => {
    if (!signInLoaded || !signIn) return;
    setLoading(true);
    setError('');
    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === 'complete' && setActive) {
        await setActive({ session: result.createdSessionId });
      }
    } catch (e: any) {
      const msg = e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || 'Sign in failed';
      setError(msg);
    }
    setLoading(false);
  }, [signIn, signInLoaded, setActive, email, password]);

  const handleSignUp = useCallback(async () => {
    if (!signUpLoaded || !signUp) return;
    setLoading(true);
    setError('');
    try {
      const [firstName, ...rest] = name.trim().split(' ');
      await signUp.create({
        emailAddress: email,
        password,
        firstName: firstName || '',
        lastName: rest.join(' ') || '',
      });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (e: any) {
      const msg = e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || 'Sign up failed';
      setError(msg);
    }
    setLoading(false);
  }, [signUp, signUpLoaded, email, password, name]);

  const handleVerify = useCallback(async () => {
    if (!signUpLoaded || !signUp) return;
    setLoading(true);
    setError('');
    try {
      const result = await signUp.attemptEmailAddressVerification({ code: verificationCode });
      if (result.status === 'complete' && setActive) {
        await setActive({ session: result.createdSessionId });
      }
    } catch (e: any) {
      const msg = e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || 'Verification failed';
      setError(msg);
    }
    setLoading(false);
  }, [signUp, signUpLoaded, setActive, verificationCode]);

  const handleForgot = useCallback(async () => {
    if (!signInLoaded || !signIn) return;
    setLoading(true);
    setError('');
    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: email,
      });
      setMessage('Check your email for a reset code.');
    } catch (e: any) {
      const msg = e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || 'Could not send reset email';
      setError(msg);
    }
    setLoading(false);
  }, [signIn, signInLoaded, email]);

  const handleGoogleSSO = useCallback(async () => {
    if (!signInLoaded || !signIn) return;
    setLoading(true);
    setError('');
    try {
      const result = await signIn.create({
        strategy: 'oauth_google',
        redirectUrl: window.location.origin + '/sso-callback',
        actionCompleteRedirectUrl: '/',
      });

      const url =
        result.firstFactorVerification?.externalVerificationRedirectURL;
      if (url) {
        window.location.href = url.toString();
        return;
      }

      if (result.status === 'complete' && setActive) {
        await setActive({ session: result.createdSessionId });
      }
    } catch (e: any) {
      const msg =
        e?.errors?.[0]?.longMessage ||
        e?.errors?.[0]?.message ||
        'Google sign-in failed';
      setError(msg);
      setLoading(false);
    }
  }, [signIn, signInLoaded, setActive]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pendingVerification) return handleVerify();
    if (mode === 'signin') return handleSignIn();
    if (mode === 'signup') return handleSignUp();
    if (mode === 'forgot') return handleForgot();
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setMessage('');
    setPendingVerification(false);
    setVerificationCode('');
  };

  if (!signInLoaded || !signUpLoaded) {
    return (
      <div className="auth-page">
        <div className="auth-overlay" />
        <div className="auth-card">
          <Loader2 className="animate-spin text-[#fbceb5]" size={32} />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-overlay" />

      <div className="auth-card">
        <h3 className="auth-title">
          {pendingVerification
            ? 'Verify Email'
            : mode === 'signin'
              ? 'Log back into Sales KB'
              : mode === 'signup'
                ? 'Create Account'
                : 'Reset Password'}
        </h3>

        {error && <div className="auth-error">{error}</div>}
        {message && <div className="auth-success">{message}</div>}

        <form onSubmit={onSubmit} className="auth-form">
          {pendingVerification ? (
            <div className="auth-field">
              <input
                type="text"
                placeholder="Verification code"
                value={verificationCode}
                onChange={e => setVerificationCode(e.target.value)}
                className="auth-input"
                autoFocus
              />
            </div>
          ) : (
            <>
              {mode === 'signup' && (
                <div className="auth-field">
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="auth-input"
                    required
                  />
                </div>
              )}

              <div className="auth-field">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="auth-input"
                  required
                  autoFocus
                />
              </div>

              {mode !== 'forgot' && (
                <div className="auth-field">
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="auth-input"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="auth-field-icon"
                  >
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              )}
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="auth-btn"
          >
            {loading ? (
              <Loader2 className="animate-spin mx-auto" size={20} />
            ) : pendingVerification ? (
              'Verify'
            ) : mode === 'signin' ? (
              'Sign In'
            ) : mode === 'signup' ? (
              'Sign Up'
            ) : (
              'Send Reset Link'
            )}
          </button>

          {mode === 'signin' && !pendingVerification && (
            <label className="auth-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
              />
              <span>Remember Me</span>
            </label>
          )}
        </form>

        {!pendingVerification && (
          <div className="auth-links">
            {mode === 'signin' ? (
              <>
                <button onClick={() => switchMode('signup')} className="auth-link">
                  Create new account
                </button>
                <button onClick={() => switchMode('forgot')} className="auth-link auth-link-muted">
                  Forgot Password
                </button>
              </>
            ) : (
              <button onClick={() => switchMode('signin')} className="auth-link">
                Already have an account? Sign In
              </button>
            )}
          </div>
        )}

        {mode === 'signin' && !pendingVerification && (
          <div className="auth-divider">
            <span>&mdash; Or Sign In With &mdash;</span>
          </div>
        )}

        {mode === 'signin' && !pendingVerification && (
          <div className="auth-social">
            <button onClick={handleGoogleSSO} className="auth-social-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
