import { useEffect, useState } from "react"

import storage from "../../utils/storage"
import Folder from "./folder"
import File from "./File"

export default function Explorer() {
    const [data, setData] = useState([])

    useEffect(() => {
        if (data.length === 0) {
            const _data = storage.getData()
            if (_data) setData(_data)
        }
    }, [data])

    const temp = () => {
        const _data = [
            {
                name: 'folder 1',
                type: 'folder'
            },
            {
                name: 'folder 2',
                type: 'folder'
            },
            {
                name: 'file 1',
                type: 'file'
            },
            {
                name: 'file 2',
                type: 'file'
            }
        ]
        localStorage.setItem('data', JSON.stringify(_data))
    }


    return (
        <>
            <h1>Folder</h1>
            {
                data?.map((item, i) => {
                    switch (item.type) {
                        case 'folder':
                            return <Folder key={i} name={item.name} />
                        case 'file':
                            return <File key={i} name={item.name} />
                        default:
                            return null
                    }
                })
            }
            <input
                type="submit"
                value='Add New file'
                onClick={() => { storage.addFile() }}
            />
            <input
                type="submit"
                onClick={temp}
            />
        </>
    )
}

