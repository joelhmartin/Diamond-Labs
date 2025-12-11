import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useProductBrand from '~/hooks/useProductBrand';

const WidgetShopBrands = () => {
    const Router = useRouter();
    const { slug } = useParams();
    const { loading, brands, getBrands } = useProductBrand();

    useEffect(() => {
        getBrands();
    }, []);

    const brandsView = useMemo(() => {
        if (loading) {
            return <p>Loading...</p>;
        }
        if (brands.length > 0) {
            const items = brands.map((item, index) => {
                const slug = item.attributes.slug || '';
                const title = item.attributes.title || '';
                return (
                    <li key={index}>
                        <Link href={`/brand/${slug}`}>{title}</Link>
                    </li>
                );
            });

            return <ul className="ps-list--brands">{items}</ul>;
        } else {
            return [];
        }
    }, [brands, loading]);

    function handleSelectBrand(e) {
        Router.push(`/brand/${e.target.value}`);
    }

    // Views

    return (
        <aside className="widget widget_shop widget_shop--brand">
            <h4 className="widget-title">By Brands</h4>
            {brandsView}
        </aside>
    );
};

export default WidgetShopBrands;
