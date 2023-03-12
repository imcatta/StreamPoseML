import pandas as pd
import time

from pose_parser.services.video_data_dataloop_merge_service import (
    VideoDataDataloopMergeService,
)
from pose_parser.services.dataset_output_transformer_service import (
    DatasetOutputTransformerService,
)

from pose_parser.serializers.dataset_serializer import DatasetSerializer


class BuildAndFormatDatasetJob:
    """This class works through json sequence data and annotation data to compile a dataset"""

    @staticmethod
    def build_dataset_from_data_files(
        annotations_data_directory: str,
        sequence_data_directory: str,
        merged_dataset_path: str | None = None,
        limit: int | None = None,
        opts: dict = {},
    ):
        vdms = VideoDataDataloopMergeService(
            annotations_data_directory=annotations_data_directory,
            sequence_data_directory=sequence_data_directory,
            process_videos=False,
            output_data_path=merged_dataset_path,
        )

        # TODO - write to file is too difficult with data this big
        # 5 videos resulted in a 235 mb json file. Yikes!
        dataset = vdms.generate_dataset(limit=limit)
        return dataset

        # dots = DatasetOutputTransformerService(opts=opts)
        # dots.format_dataset(generated_raw_dataset=dataset)

    @staticmethod
    def build_dataset_from_videos(
        annotations_directory: str,
        video_directory: str,
        limit: int | None = None,
    ):
        vdms = VideoDataDataloopMergeService(
            annotations_directory=annotations_directory,
            video_directory=video_directory,
            process_videos=True,
        )

        dataset = vdms.generate_dataset(limit=limit)
        return dataset

    @staticmethod
    def format_dataset(dataset: list):
        formatted_data = DatasetSerializer().serialize(dataset)
        return formatted_data

    @staticmethod
    def write_dataset_to_csv(csv_location: str, formatted_dataset: list):
        df = pd.json_normalize(data=formatted_dataset)
        filename = f"dataset_{time.time_ns()}.csv"
        output_path = f"{csv_location}/{filename}"
        df.to_csv(output_path)
        return True


class BuildAndFormatDatasetJobError(Exception):
    """Raise when there's an issue with the BuildAndFormatDatasetJob class"""
