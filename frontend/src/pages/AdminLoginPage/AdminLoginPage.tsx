import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { adminLoginSchema, type AdminLoginValues } from '@/schemas/adminSchema';
import styles from './AdminLoginPage.module.css';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { admin, login } = useAdminAuth();
  const from = (location.state as { from?: string } | null)?.from ?? '/admin';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<AdminLoginValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { username: '', password: '' },
  });

  useEffect(() => {
    if (admin) {
      navigate(from, { replace: true });
    }
  }, [admin, from, navigate]);

  const onSubmit = async (values: AdminLoginValues) => {
    try {
      await login(values.username, values.password);
      navigate(from, { replace: true });
    } catch {
      setError('root', { message: 'Neplatné prihlasovacie údaje' });
    }
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Admin prihlásenie</h2>
      <p className={styles.note}>
        Autentifikácia cez HTTP-only cookies (access + refresh token).
      </p>

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={styles.field}>
          <label htmlFor="username">Používateľské meno</label>
          <input id="username" type="text" autoComplete="username" {...register('username')} />
          {errors.username && (
            <span className={styles.error}>{errors.username.message}</span>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="password">Heslo</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
          {errors.password && (
            <span className={styles.error}>{errors.password.message}</span>
          )}
        </div>

        {errors.root && <p className={styles.error}>{errors.root.message}</p>}

        <button type="submit" className={styles.button} disabled={isSubmitting}>
          {isSubmitting ? 'Prihlasujem…' : 'Prihlásiť sa'}
        </button>
      </form>
    </section>
  );
}
