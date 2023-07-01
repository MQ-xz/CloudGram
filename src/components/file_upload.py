from kivymd.uix.filemanager import MDFileManager
from kivy.lang import Builder
from kivy.properties import StringProperty
from kivy.uix.boxlayout import BoxLayout

from src.utils.telegram import telegram

Builder.load_string(
    """
<FileUploader>:
    orientation: "vertical"
    pos_hint: {'right': .99}

    # MDFloatingActionButtonSpeedDial:
    #         data: {
    #                 "Python": "language-python",
    #                 "PHP": "language-php",
    #                 "C++": "language-cpp",
    #             }
    #         root_button_anim: True
   
    
    # MDFloatingActionButton:
    #     icon: "upload"
    #     pos_hint: {'right': .99}
    #     on_release: root.show_file_manager()

    # MDLabel:
    #     text: root.selected_file if root.selected_file else "No file selected"
    #     halign: "center"
"""
)


class FileUploader(BoxLayout):
    # data =
    selected_file = StringProperty("")

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.file_manager = MDFileManager(
            exit_manager=self.exit_manager,
            select_path=self.select_path,
        )

    def show_file_manager(self):
        self.file_manager.show("/")

    def select_path(self, path):
        self.selected_file = path
        print(path)
        telegram.send_document("me", path.replace("\\", "/"))
        self.file_manager.close()

    def exit_manager(self, *args):
        self.file_manager.close()
        self.selected_file = ""
