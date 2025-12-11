import React from 'react';
import Link from 'next/link';
import MenuDropdown from '~/components/elements/menu/MenuDropdown';
import MegaMenu from '~/components/elements/menu/MegaMenu';

const DefaultMenuItem = ({ item }) => {
    if (item.subMenu) {
        return <MenuDropdown source={item} key={item.text} />;
    } else if (item.megaContent) {
        return <MegaMenu source={item} key={item.text} />;
    }
    return (
        <li key={item.text}>
            <Link href={item.url}>
                {item.icon && <i className={item.icon} />}
                {item.text}
            </Link>
        </li>
    );
};

const DefaultMenu = ({ source, className }) => {
    if (!source || source.length === 0) {
        return (
            <ul className={className}>
                <li>
                    <a href="#" onClick={(e) => e.preventDefault()}>
                        No menu item.
                    </a>
                </li>
            </ul>
        );
    }

    const menuItems = source.map((item) => (
        <DefaultMenuItem item={item} key={item.text} />
    ));
    return <ul className={className}>{menuItems}</ul>;
};

export default DefaultMenu;
