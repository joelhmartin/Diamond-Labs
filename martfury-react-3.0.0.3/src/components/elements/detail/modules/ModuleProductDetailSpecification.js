import React, { useMemo } from 'react';
import Link from 'next/link';

const ModuleProductDetailSpecification = ({ product }) => {
    const { product_categories } = product.attributes;

    const productCategories = useMemo(() => {
        if (product_categories.length === 0) return <p>No category found.</p>;
        else {
            return product_categories.data.map((category) => (
                <Link href={`/category/${category.slug}`} key={category.id}>
                    {category.attributes.title}
                </Link>
            ));
        }
    }, [product_categories]);

    return (
        <div className="ps-product__specification">
            <Link href={'/page/blank'} className="report">
                Report Abuse
            </Link>
            <p>
                <strong>SKU:</strong> SF1133569600-1
            </p>
            <p className="categories">
                <strong>Categories:</strong>
                {productCategories}
            </p>
            <p className="tags">
                <strong>Tags:</strong>
                <Link href={'/shop'}>sofa</Link>
                <Link href={'/shop'}>technologies</Link>
                <Link href={'/shop'}>wireless</Link>
            </p>
        </div>
    );
};

export default ModuleProductDetailSpecification;
