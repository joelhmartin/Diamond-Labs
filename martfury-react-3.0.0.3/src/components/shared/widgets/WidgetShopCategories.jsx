import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import useProducCategory from '~/hooks/useProducCategory';

const WidgetShopCategories = () => {
    const { loading, categories, getCategories } = useProducCategory();
    const [test, setSet] = useState(0);

    useEffect(() => {
        getCategories();
    }, []);

    const categoriesView = useMemo(() => {
        if (loading) {
            return <p>Loading...</p>;
        }
        if (categories.length > 0) {
            const items = categories.map((item, index) => {
                const slug = item.attributes.slug || '';
                const title = item.attributes.title || '';
                return (
                    <li key={index}>
                        <Link href={`/category/${slug}`}>{title}</Link>
                    </li>
                );
            });
            return <ul className="ps-list--categories">{items}</ul>;
        } else {
            return [];
        }
    }, [categories, loading]);

    return (
        <aside className="widget widget_shop">
            <h4 className="widget-title">Categories</h4>
            {categoriesView}
        </aside>
    );
};

export default WidgetShopCategories;
