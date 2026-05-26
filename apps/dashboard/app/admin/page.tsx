import { notFound } from 'next/navigation';

export default function AdminPage(): never {
  // 운영 관리 페이지는 빙고 데이 기간 임시 비활성 (학습자 노출 방지)
  notFound();
}
