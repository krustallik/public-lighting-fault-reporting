import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { adminLoginSchema, type AdminLoginValues } from '@/schemas/adminSchema';
import styles from './AdminLoginPage.module.css';

export function AdminLoginPage() {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<AdminLoginValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = async (values: AdminLoginValues) => {
    try {
      await api.adminLogin(values);
      navigate('/admin/light-points');
    } catch {
      setError('root', { message: 'Prihlásenie zlyhalo (skeleton)' });
    }
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Admin prihlásenie</h2>
      <p className={styles.note}>Autentifikácia zatiaľ nie je plne implementovaná.</p>

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
          Prihlásiť sa
        </button>
      </form>
    </section>
  );
}
